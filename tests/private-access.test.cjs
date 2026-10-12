'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const root = require('node:path').resolve(__dirname, '..');
const guardSource = fs.readFileSync(root + '/private-access.js', 'utf8');
const appSource = fs.readFileSync(root + '/app.js', 'utf8');
const pause = () => new Promise(resolve => setTimeout(resolve, 12));
const good = () => ({allowed: true, reason: 'authorized', active_devices: 3, max_devices: 3});
const denied = reason => ({allowed: false, reason, active_devices: 3, max_devices: 3});
function session(id = 'owner', sid = 'session-1') {
  const token = Buffer.from(JSON.stringify({session_id: sid, exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url');
  return {user: {id, email: id + '@example.invalid'}, access_token: 'header.' + token + '.signature'};
}
class DetailEvent extends Event { constructor(name, options = {}) { super(name, options); this.detail = options.detail; } }
class Element extends EventTarget {
  constructor(tag = 'div') { super(); this.tagName = tag.toUpperCase(); this.children = []; this.hidden = false; this.inert = false; this.disabled = false; this.open = false; this.value = ''; this.textContent = ''; this.className = ''; this.classList = {add() {}, remove() {}}; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  reportValidity() { return true; }
  remove() {}
}
function harness({initialSession = null, response = good, configured = true} = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const elements = new Map();
  const ids = ['private-app', 'private-access', 'private-login-form', 'private-access-message', 'private-devices-dialog', 'private-devices-list', 'private-devices-message', 'private-device-name', 'private-email', 'private-password', 'private-retry-btn', 'private-manage-btn', 'private-logout-btn', 'private-login-btn', 'private-devices-refresh', 'private-devices-close', 'auth-dialog', 'auth-message'];
  for (const id of ids) elements.set('#' + id, new Element(id.includes('dialog') ? 'dialog' : 'div'));
  elements.get('#private-app').hidden = true;
  doc.querySelector = selector => { if (!elements.has(selector)) throw new Error('Unexpected selector: ' + selector); return elements.get(selector); };
  doc.querySelectorAll = selector => { assert.equal(selector, 'dialog[open]'); return [...elements.values()].filter(el => el.tagName === 'DIALOG' && el.open); };
  doc.createElement = tag => new Element(tag);
  doc.body = new Element('body');
  doc.hidden = false;
  const calls = [];
  const localReads = [];
  let current = initialSession;
  let authCallback;
  let responseFn = response;
  let appLoads = 0;
  let reloads = 0;
  let list = [];
  const client = {
    auth: {
      getSession: async () => ({data: {session: current}, error: null}),
      onAuthStateChange: callback => { authCallback = callback; },
      signInWithPassword: async () => ({data: {session: current}, error: null}),
      signOut: async options => { calls.push(['signOut', options]); current = null; authCallback('SIGNED_OUT', null); return {error: null}; }
    },
    rpc: async (name, params) => {
      calls.push([name, params]);
      if (name === 'personal_app_list_devices') return {data: list, error: null};
      if (name === 'personal_app_revoke_device') { responseFn = good; return {data: {revoked: true}, error: null}; }
      assert.equal(name, 'personal_app_access');
      return {data: await responseFn(), error: null};
    }
  };
  doc.body.append = el => {
    doc.body.children.push(el);
    if (el.tagName === 'SCRIPT') {
      assert.equal(el.src, 'app.js');
      assert.equal(elements.get('#private-app').hidden, true, 'editor must still be hidden when script loads');
      appLoads++;
      setImmediate(() => { win.dispatchEvent(new Event('notas:private-ready')); el.onload(); });
    }
  };
  win.NOTAS_CONFIG = configured ? {supabaseUrl: 'https://test.supabase.co', supabasePublishableKey: 'sb_publishable_test'} : {};
  win.supabase = {createClient: () => client};
  const context = {
    window: win, document: doc, navigator: {userAgent: 'Test browser', maxTouchPoints: 0},
    localStorage: {getItem(key) { localReads.push(key); return null; }, setItem() {}},
    location: {reload() { reloads++; }},
    addEventListener: win.addEventListener.bind(win),
    Event, CustomEvent: DetailEvent, AbortController, URL, Intl, console,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); if (delay > 1000) timer.unref(); return timer; },
    clearTimeout, setInterval() {}, requestAnimationFrame: callback => setImmediate(callback), confirm: () => true
  };
  vm.runInNewContext(guardSource, context, {filename: 'private-access.js'});
  return {
    win, doc, elements, calls, localReads,
    get appLoads() { return appLoads; }, get reloads() { return reloads; },
    changeSession(next) { current = next; authCallback(next ? 'SIGNED_IN' : 'SIGNED_OUT', next); },
    setResponse(fn) { responseFn = fn; }, setDevices(value) { list = value; },
    get api() { return win.NOTAS_PRIVATE; }
  };
}
(async () => {
  let cases = 0;
  function blocked(h) {
    assert.equal(h.api.authorized, false);
    assert.equal(h.elements.get('#private-app').hidden, true);
    assert.equal(h.elements.get('#private-access').hidden, false);
  }
  {
    const h = harness(); await pause(); blocked(h); assert.equal(h.appLoads, 0);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.localReads, ['notas-pro:private-device-name']); cases++;
  }
  for (const reason of ['not_owner', 'device_limit', 'session_revoked', 'invalid_session']) {
    const h = harness({initialSession: session(), response: () => denied(reason)}); await pause(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  for (const response of [() => { throw new Error('Network unavailable'); }, () => ({allowed: true}), () => ({...good(), max_devices: 4})]) {
    const h = harness({initialSession: session(), response}); await pause(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  {
    const h = harness({initialSession: session()}); await pause();
    assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1); assert.equal(h.elements.get('#private-app').hidden, false);
    let locks = 0; h.win.addEventListener('notas:private-locked', () => locks++);
    h.setResponse(() => denied('session_revoked')); await h.api.validate(); blocked(h); assert.equal(locks, 1); cases++;
  }
  {
    const h = harness({initialSession: session(), response: () => denied('device_limit')});
    h.setDevices([{session_id: 'first', device_name: 'PC MSI', is_current: false, last_seen_at: '2026-10-12T12:00:00Z'}]);
    await pause(); h.api.manageDevices(); await pause();
    assert.equal(h.elements.get('#private-devices-dialog').open, true);
    assert.equal(h.appLoads, 0);
    const rows = h.elements.get('#private-devices-list').children;
    assert.equal(rows.length, 1);
    rows[0].children[1].dispatchEvent(new Event('click'));
    await pause(); assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1);
    assert.equal(h.calls.filter(([name]) => name === 'personal_app_revoke_device').length, 1); cases++;
  }
  {
    let release;
    const h = harness({initialSession: session(), response: () => new Promise(resolve => { release = resolve; })});
    await pause(); h.changeSession(null); release(good()); await pause();
    blocked(h); assert.equal(h.appLoads, 0, 'late RPC must not undo a logout'); cases++;
  }
  {
    const h = harness({initialSession: session()}); await pause(); await h.api.signOut();
    blocked(h); assert.equal(h.reloads, 1);
    assert.equal(h.calls.find(([name]) => name === 'signOut')[1].scope, 'local'); cases++;
  }
  {
    const h = harness({initialSession: session()}); await pause();
    h.win.addEventListener('notas:private-before-reload', event => event.preventDefault());
    await h.api.signOut(); blocked(h); assert.equal(h.reloads, 0, 'do not discard an unsaved draft when recovery storage fails'); cases++;
  }
  {
    const h = harness({configured: false}); await pause(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  {
    vm.runInNewContext(appSource, {window: {}, document: {querySelector() { throw new Error('Unauthorized DOM access'); }}, localStorage: {getItem() { throw new Error('Unauthorized note read'); }}}, {filename: 'app.js'}); cases++;
  }
  console.log(`PASS: ${cases} private-access scenarios; no real account, note, network, or browser used.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
