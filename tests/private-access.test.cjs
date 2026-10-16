'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const root = require('node:path').resolve(__dirname, '..');
const guardSource = fs.readFileSync(root + '/private-access.js', 'utf8');
const appSource = fs.readFileSync(root + '/app.js', 'utf8');
const htmlSource = fs.readFileSync(root + '/index.html', 'utf8');
const cssSource = fs.readFileSync(root + '/style.css', 'utf8');
const START_TIME = Date.UTC(2026, 9, 16, 10);
const DEVICE_NAME_KEY = 'notas-pro:private-device-name';
const good = () => ({allowed: true, reason: 'authorized', active_devices: 3, max_devices: 3});
const denied = reason => ({allowed: false, reason, active_devices: 3, max_devices: 3});
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
function session(id = 'owner', sid = 'session-1') {
  const token = Buffer.from(JSON.stringify({session_id: sid, exp: START_TIME / 1000 + 3600})).toString('base64url');
  return {user: {id, email: id + '@example.invalid'}, access_token: 'header.' + token + '.signature'};
}
function htmlTag(id) {
  const tag = htmlSource.match(new RegExp('<[a-z][^>]*\\bid="' + id + '"[^>]*>', 'i'))?.[0];
  assert.ok(tag, 'Missing initial HTML element: ' + id);
  return tag;
}
function htmlAttribute(tag, name) { return new RegExp('\\s' + name + '(?:\\s|>|=)', 'i').test(tag); }
class DetailEvent extends Event { constructor(name, options = {}) { super(name, options); this.detail = options.detail; } }
class Element extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase(); this.children = []; this.hidden = false; this.inert = false;
    this.disabled = false; this.open = false; this.value = ''; this.textContent = ''; this.className = '';
    const classes = new Set();
    this.classList = {add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name)};
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  reportValidity() { return true; }
  remove() {}
}
function harness({initialSession = null, restoration, response = good, configured = true, autoAppReady = true, omitStartupStatus = false} = {}) {
  const win = new EventTarget();
  const doc = new EventTarget();
  const elements = new Map();
  const ids = ['private-app', 'private-access', 'private-login-form', 'private-access-message', 'private-startup-status', 'private-devices-dialog', 'private-devices-list', 'private-devices-message', 'private-device-name', 'private-email', 'private-password', 'private-retry-btn', 'private-manage-btn', 'private-logout-btn', 'private-login-btn', 'private-devices-refresh', 'private-devices-close', 'auth-dialog', 'auth-message'];
  for (const id of ids) {
    const element = new Element(id.includes('dialog') ? 'dialog' : 'div');
    const tag = htmlTag(id);
    element.hidden = htmlAttribute(tag, 'hidden'); element.inert = htmlAttribute(tag, 'inert');
    elements.set('#' + id, element);
  }
  doc.querySelector = selector => {
    if (omitStartupStatus && selector === '#private-startup-status') return null;
    if (!elements.has(selector)) throw new Error('Unexpected selector: ' + selector);
    return elements.get(selector);
  };
  doc.querySelectorAll = selector => { assert.equal(selector, 'dialog[open]'); return [...elements.values()].filter(el => el.tagName === 'DIALOG' && el.open); };
  doc.createElement = tag => new Element(tag);
  doc.body = new Element('body'); doc.body.classList.add('private-locked'); doc.hidden = false;
  const calls = [], localReads = [], scheduledTimers = [], scheduledIntervals = [], frames = [], scriptLoads = [];
  const timers = new Map();
  const sessionResults = restoration === undefined ? [] : [restoration];
  let now = START_TIME, timerId = 0, current = initialSession, authCallback, responseFn = response;
  let appLoads = 0, sessionReads = 0, reloads = 0, list = [];
  function view() {
    return {at: now - START_TIME, shellHidden: elements.get('#private-app').hidden, shellInert: elements.get('#private-app').inert,
      gateHidden: elements.get('#private-access').hidden, formHidden: elements.get('#private-login-form').hidden};
  }
  const stages = [{stage: 'initial-html', ...view()}];
  function completeApplication() {
    const script = scriptLoads.shift(); assert.ok(script, 'No pending application script');
    stages.push({stage: 'app-execution', ...view()});
    assert.equal(win.NOTAS_PRIVATE.authorized, true, 'application must not execute before server authorization');
    assert.equal(elements.get('#private-app').hidden, true, 'editor must remain hidden during application execution');
    assert.equal(elements.get('#private-app').inert, true, 'editor must remain inert during application execution');
    win.dispatchEvent(new Event('notas:private-ready')); script.onload();
  }
  const client = {
    auth: {
      getSession: async () => {
        sessionReads++; stages.push({stage: 'restore-session', ...view()});
        const result = sessionResults.length ? await sessionResults.shift() : current;
        return {data: {session: result}, error: null};
      },
      onAuthStateChange: callback => { authCallback = callback; },
      signInWithPassword: async () => ({data: {session: current}, error: null}),
      signOut: async options => { calls.push(['signOut', options]); current = null; authCallback('SIGNED_OUT', null); return {error: null}; }
    },
    rpc: async (name, params) => {
      calls.push([name, params]); stages.push({stage: name, ...view()});
      if (name === 'personal_app_list_devices') return {data: list, error: null};
      if (name === 'personal_app_revoke_device') { responseFn = good; return {data: {revoked: true}, error: null}; }
      assert.equal(name, 'personal_app_access'); return {data: await responseFn(), error: null};
    }
  };
  doc.body.append = el => {
    doc.body.children.push(el);
    if (el.tagName === 'SCRIPT') {
      assert.equal(el.src, 'app.js');
      assert.equal(win.NOTAS_PRIVATE.authorized, true, 'do not load the application before server authorization');
      assert.equal(elements.get('#private-app').hidden, true, 'editor must still be hidden when script loads');
      appLoads++; scriptLoads.push(el); stages.push({stage: 'app-download', ...view()});
      if (autoAppReady) queueMicrotask(completeApplication);
    }
  };
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  function schedule(callback, delay = 0) {
    const id = ++timerId; timers.set(id, {id, callback, delay, at: now + delay});
    scheduledTimers.push({id, delay, at: now - START_TIME}); return id;
  }
  win.NOTAS_CONFIG = configured ? {supabaseUrl: 'https://test.supabase.co', supabasePublishableKey: 'sb_publishable_test'} : {};
  win.supabase = {createClient: () => client};
  const context = {
    window: win, document: doc, navigator: {userAgent: 'Test browser', maxTouchPoints: 0},
    localStorage: {getItem(key) { localReads.push(key); assert.equal(key, DEVICE_NAME_KEY, 'guard must not read note storage'); return null; }, setItem(key) { assert.equal(key, DEVICE_NAME_KEY); }},
    location: {reload() { reloads++; }}, addEventListener: win.addEventListener.bind(win),
    Event, CustomEvent: DetailEvent, AbortController, URL, Intl, console, Date: ClockDate,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    setTimeout: schedule, clearTimeout: id => timers.delete(id),
    setInterval(callback, delay) { scheduledIntervals.push({callback, delay}); return ++timerId; },
    requestAnimationFrame(callback) { frames.push(callback); }, confirm: () => true
  };
  vm.runInNewContext(guardSource, context, {filename: 'private-access.js'});
  // Drain promise jobs and due tasks without sleeping or advancing this clock.
  // Positive timers only run when a test explicitly calls advance().
  async function flush() {
    for (let turn = 0; turn < 50; turn++) {
      await new Promise(setImmediate);
      const due = [...timers.values()].filter(timer => timer.at <= now).sort((a, b) => a.at - b.at || a.id - b.id);
      const pendingFrames = frames.splice(0);
      if (!due.length && !pendingFrames.length) return;
      for (const timer of due) if (timers.delete(timer.id)) timer.callback();
      for (const callback of pendingFrames) callback(now);
    }
    throw new Error('Synthetic task queue did not settle');
  }
  return {
    win, doc, elements, calls, localReads, stages, scheduledTimers, scheduledIntervals,
    flush, async advance(milliseconds) { now += milliseconds; await flush(); }, completeApplication,
    get elapsed() { return now - START_TIME; }, get appLoads() { return appLoads; }, get sessionReads() { return sessionReads; }, get reloads() { return reloads; },
    emitAuth(event, next = current) { current = next; authCallback(event, next); },
    changeSession(next) { current = next; authCallback(next ? 'SIGNED_IN' : 'SIGNED_OUT', next); },
    queueSession(result) { sessionResults.push(result); },
    setResponse(fn) { responseFn = fn; }, setDevices(value) { list = value; }, get api() { return win.NOTAS_PRIVATE; }
  };
}
(async () => {
  let cases = 0;
  function blocked(h) {
    assert.equal(h.api.authorized, false); assert.equal(h.elements.get('#private-app').hidden, true);
    assert.equal(h.elements.get('#private-app').inert, true); assert.equal(h.elements.get('#private-access').hidden, false);
  }
  function restoring(h) {
    assert.equal(h.elements.get('#private-app').hidden, true); assert.equal(h.elements.get('#private-app').inert, true);
    assert.equal(h.elements.get('#private-access').hidden, true, 'restoration must not show a login card');
    assert.equal(h.elements.get('#private-login-form').hidden, true, 'restoration must not show login fields');
    assert.deepEqual(h.localReads, [DEVICE_NAME_KEY], 'no note storage may be read by the guard');
  }
  function accessCalls(h) { return h.calls.filter(([name]) => name === 'personal_app_access').length; }
  {
    assert.ok(htmlAttribute(htmlTag('private-access'), 'hidden')); assert.ok(htmlAttribute(htmlTag('private-login-form'), 'hidden'));
    assert.ok(htmlAttribute(htmlTag('private-app'), 'hidden')); assert.ok(htmlAttribute(htmlTag('private-app'), 'inert'));
    assert.match(htmlSource, /<link\b(?=[^>]*\brel="preload")(?=[^>]*\bhref="app\.js")(?=[^>]*\bas="script")[^>]*>/);
    assert.doesNotMatch(htmlSource, /<script\b[^>]*\bsrc="app\.js"/);
    assert.match(htmlSource, /<noscript>[\s\S]*?<\/noscript>/);
    assert.match(cssSource, /\*,\*::before,\*::after\s*\{[^}]*animation:none!important;[^}]*transition:none!important;/); cases++;
  }
  {
    const h = harness(); restoring(h); await h.flush(); blocked(h); assert.equal(h.appLoads, 0);
    assert.equal(h.elements.get('#private-login-form').hidden, false);
    assert.equal(h.calls.length, 0); assert.deepEqual(h.localReads, [DEVICE_NAME_KEY]); cases++;
  }
  {
    // A newly activated service worker can deliver the new guard to an older
    // document. The optional status element must not break authorization.
    const h = harness({initialSession: session(), omitStartupStatus: true});
    await h.flush();
    assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1);
    assert.equal(h.elements.get('#private-app').hidden, false);
    assert.equal(h.elements.get('#private-access').hidden, true);
    h.setResponse(() => denied('session_revoked')); await h.api.validate(); blocked(h); cases++;
  }
  {
    const restore = deferred(); const h = harness({restoration: restore.promise});
    restoring(h); await h.advance(750); restoring(h); assert.equal(h.appLoads, 0); assert.equal(accessCalls(h), 0);
    restore.resolve(null); await h.flush(); blocked(h);
    assert.equal(h.elements.get('#private-login-form').hidden, false, 'show login only after missing session is confirmed');
    assert.equal(h.elements.get('#private-startup-status').hidden, true); cases++;
  }
  for (const reason of ['not_owner', 'device_limit', 'session_revoked', 'invalid_session']) {
    const h = harness({initialSession: session(), response: () => denied(reason)}); await h.flush(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  for (const response of [() => { throw new Error('Network unavailable'); }, () => ({allowed: true}), () => ({...good(), max_devices: 4})]) {
    const h = harness({initialSession: session(), response}); await h.flush(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  {
    const owner = session(), restore = deferred(), approval = deferred();
    const h = harness({initialSession: owner, restoration: restore.promise, response: () => approval.promise, autoAppReady: false});
    restoring(h); h.emitAuth('INITIAL_SESSION', owner); h.emitAuth('SIGNED_IN', owner); await h.flush(); restoring(h);
    restore.resolve(owner); await h.flush(); restoring(h);
    assert.equal(accessCalls(h), 1); assert.equal(h.appLoads, 0); assert.equal(h.api.authorized, false);
    h.emitAuth('INITIAL_SESSION', owner); h.emitAuth('SIGNED_IN', owner); await h.flush();
    assert.equal(accessCalls(h), 1, 'duplicate startup auth events must share the pending authorization');
    approval.resolve(good()); await h.flush(); restoring(h); assert.equal(h.appLoads, 1); assert.equal(h.api.authorized, true);
    h.emitAuth('SIGNED_IN', owner); await h.flush(); restoring(h); h.completeApplication(); await h.flush();
    assert.equal(h.api.authorized, true); assert.equal(h.elements.get('#private-app').hidden, false); assert.equal(h.elements.get('#private-app').inert, false);
    assert.equal(h.elements.get('#private-access').hidden, true); assert.equal(h.elements.get('#private-login-form').hidden, true);
    assert.equal(h.elements.get('#private-startup-status').hidden, true); assert.equal(accessCalls(h), 1);
    assert.ok(h.stages.every(stage => stage.gateHidden && stage.formHidden), 'login must remain hidden across asynchronous startup boundaries'); cases++;
  }
  {
    const restore = deferred(), approval = deferred();
    const h = harness({restoration: restore.promise, response: () => approval.promise, autoAppReady: false});
    await h.advance(250); restoring(h); restore.resolve(session()); await h.flush(); assert.equal(h.appLoads, 0); assert.equal(h.api.authorized, false);
    await h.advance(400); restoring(h); approval.resolve(good()); await h.flush(); assert.equal(h.appLoads, 1); restoring(h);
    await h.advance(25); h.completeApplication(); await h.flush(); assert.equal(h.api.authorized, true); assert.equal(h.elements.get('#private-app').hidden, false);
    assert.equal(h.elapsed, 675, 'opening completes when the controlled dependencies finish, without advancing an opening timer');
    assert.deepEqual(h.stages.filter(stage => ['personal_app_access', 'app-download', 'app-execution'].includes(stage.stage)).map(({stage, at}) => ({stage, at})),
      [{stage: 'personal_app_access', at: 250}, {stage: 'app-download', at: 650}, {stage: 'app-execution', at: 675}]);
    assert.deepEqual(h.scheduledTimers.filter(timer => timer.delay > 0).map(timer => timer.delay), [15000, 3600000 - 675], 'only RPC timeout and session expiry may schedule positive timeouts during opening');
    assert.deepEqual(h.scheduledIntervals.map(timer => timer.delay), [60000], 'background revalidation must not delay startup'); cases++;
  }
  {
    const approval = deferred(); const h = harness({initialSession: session(), response: () => approval.promise});
    await h.flush(); restoring(h); await h.advance(14999); restoring(h); assert.equal(h.appLoads, 0);
    await h.advance(1); blocked(h); assert.equal(h.appLoads, 0);
    assert.equal(h.elements.get('#private-login-form').hidden, true, 'RPC failure is not a missing session');
    assert.equal(h.elements.get('#private-retry-btn').hidden, false); cases++;
  }
  {
    const h = harness({initialSession: session()}); await h.flush();
    assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1); assert.equal(h.elements.get('#private-app').hidden, false);
    let locks = 0; h.win.addEventListener('notas:private-locked', () => locks++);
    h.setResponse(() => denied('session_revoked')); await h.api.validate(); blocked(h); assert.equal(locks, 1); cases++;
  }
  {
    const h = harness({initialSession: session(), response: () => denied('device_limit')});
    h.setDevices([{session_id: 'first', device_name: 'PC MSI', is_current: false, last_seen_at: '2026-10-12T12:00:00Z'}]);
    await h.flush(); h.api.manageDevices(); await h.flush(); assert.equal(h.elements.get('#private-devices-dialog').open, true); assert.equal(h.appLoads, 0);
    const rows = h.elements.get('#private-devices-list').children; assert.equal(rows.length, 1);
    rows[0].children[1].dispatchEvent(new Event('click')); await h.flush(); assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1);
    assert.equal(h.calls.filter(([name]) => name === 'personal_app_revoke_device').length, 1); cases++;
  }
  {
    const approval = deferred(); const h = harness({initialSession: session(), response: () => approval.promise});
    await h.flush(); h.changeSession(null); approval.resolve(good()); await h.flush(); blocked(h); assert.equal(h.appLoads, 0, 'late RPC must not undo a logout'); cases++;
  }
  {
    // Admission already in flight may have computed device_limit before a
    // device is removed. Its result cannot replace a post-revocation check.
    const staleAdmission = deferred();
    const h = harness({initialSession: session(), response: () => denied('device_limit')});
    h.setDevices([{session_id: 'other-device', device_name: 'Synthetic device', is_current: false}]);
    await h.flush(); blocked(h); h.api.manageDevices(); await h.flush();
    const remove = h.elements.get('#private-devices-list').children[0].children[1];
    h.setResponse(() => staleAdmission.promise);
    const pending = h.api.validate(); await h.flush();
    assert.equal(accessCalls(h), 2); remove.dispatchEvent(new Event('click')); await h.flush();
    assert.equal(h.calls.filter(([name]) => name === 'personal_app_revoke_device').length, 1);
    assert.equal(h.api.authorized, false); assert.equal(h.appLoads, 0);
    staleAdmission.resolve(denied('device_limit')); assert.equal(await pending, false); await h.flush();
    assert.equal(accessCalls(h), 3, 'revocation must trigger a fresh admission after the stale response settles');
    assert.equal(h.api.authorized, true); assert.equal(h.appLoads, 1);
    assert.equal(h.elements.get('#private-access').hidden, true); cases++;
  }
  {
    const owner = session(), restore = deferred(); const h = harness({initialSession: owner, restoration: restore.promise});
    h.emitAuth('SIGNED_OUT', null); blocked(h); restore.resolve(owner); await h.flush(); blocked(h);
    assert.equal(h.appLoads, 0); assert.equal(accessCalls(h), 0, 'late initial session restoration must not undo SIGNED_OUT before any identity was known');
    assert.equal(h.elements.get('#private-login-form').hidden, false); cases++;
  }
  {
    const owner = session(), restore = deferred(); const h = harness({initialSession: owner}); await h.flush();
    h.queueSession(restore.promise); const pending = h.api.validate(); h.emitAuth('SIGNED_OUT', null); blocked(h); restore.resolve(owner);
    assert.equal(await pending, false, 'discard stale getSession before it can reauthorize the old identity'); blocked(h); await h.flush(); blocked(h);
    assert.equal(accessCalls(h), 1, 'stale restoration must not make another authorization request'); cases++;
  }
  {
    const old = session(), next = session('owner', 'session-2'), restore = deferred(), approval = deferred();
    const h = harness({initialSession: old}); await h.flush(); const authorized = [];
    h.win.addEventListener('notas:private-authorized', event => authorized.push(event.detail.session));
    h.queueSession(restore.promise); h.setResponse(() => approval.promise);
    const pending = h.api.validate(); h.emitAuth('SIGNED_IN', next); restoring(h); restore.resolve(old);
    assert.equal(await pending, false, 'a different session must invalidate the pending getSession snapshot');
    assert.equal(h.api.authorized, false); assert.equal(authorized.length, 0); await h.flush(); restoring(h);
    assert.equal(accessCalls(h), 2, 'only the new session may request its own authorization'); approval.resolve(good()); await h.flush();
    assert.equal(h.api.session, next); assert.deepEqual(authorized, [next]); assert.equal(h.appLoads, 1); cases++;
  }
  {
    const h = harness({initialSession: session()}); await h.flush(); await h.api.signOut(); await h.flush(); blocked(h); assert.equal(h.reloads, 1);
    assert.equal(h.calls.find(([name]) => name === 'signOut')[1].scope, 'local'); cases++;
  }
  {
    const h = harness({initialSession: session()}); await h.flush();
    h.win.addEventListener('notas:private-before-reload', event => event.preventDefault());
    await h.api.signOut(); await h.flush(); blocked(h); assert.equal(h.reloads, 0, 'do not discard an unsaved draft when recovery storage fails'); cases++;
  }
  {
    const h = harness({configured: false}); await h.flush(); blocked(h); assert.equal(h.appLoads, 0); cases++;
  }
  for (const privateState of [undefined, {authorized: false}, {authorized: true, session: null}]) {
    vm.runInNewContext(appSource, {window: {NOTAS_PRIVATE: privateState}, document: {querySelector() { throw new Error('Unauthorized DOM access'); }}, localStorage: {getItem() { throw new Error('Unauthorized note read'); }}}, {filename: 'app.js'}); cases++;
  }
  console.log(`PASS: ${cases} private-access scenarios; controlled promises and synthetic clock; no real account, note, network, or browser used.`);
  console.log('Synthetic startup: session restoration 250 ms + server approval 400 ms + script readiness 25 ms = 675 ms; no added opening delay. This is a dependency-order test, not a real-device benchmark.');
})().catch(error => { console.error(error); process.exitCode = 1; });
