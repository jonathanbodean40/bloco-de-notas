'use strict';

// Run with Node 24+: node --experimental-vm-modules --test supabase/tests/notes-reminders-handler.test.cjs
// Uses Node's TypeScript parser and isolated modules. All database/auth/push
// imports are mocks, fetch is forbidden, and no credentials or network are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const OWNER = '38409eff-d6a5-49ef-b2a2-1d2a8312cc1b';
const OTHER = '10000000-0000-4000-8000-000000000002';
const OWN_REMINDER = '20000000-0000-4000-8000-000000000001';
const OTHER_REMINDER = '20000000-0000-4000-8000-000000000002';
const OWNER_DEVICE = 'owner-device';
const OTHER_DEVICE = 'other-device';
const TOKEN = 'isolated-test-user-token';
const SERVICE_KEY = 'isolated-test-service-key';
const ANON_KEY = 'isolated-test-anon-key';
const CRON_SECRET = 'isolated-test-cron-secret';
const sourcePath = path.join(__dirname, '../functions/notes-reminders/index.ts');
const code = stripTypeScriptTypes(fs.readFileSync(sourcePath, 'utf8'), {
  mode: 'strip', sourceUrl: sourcePath,
});

const copy = value => structuredClone(value);
function subscription(name) {
  return {endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: {p256dh: 'p'.repeat(87), auth: 'a'.repeat(22)}};
}
function fixtures() {
  return {
    notes_push_settings: [{id: true, public_key: 'test-vapid-public',
      private_key: 'test-vapid-private', cron_secret: CRON_SECRET}],
    notes_reminders: [
      {id: OWN_REMINDER, user_id: OWNER, label: 'Owner reminder', hidden_at: null,
        due_at: '2030-01-01T00:00:00Z', status: 'scheduled', revision: 'owner-revision'},
      {id: OTHER_REMINDER, user_id: OTHER, label: 'Other private reminder', hidden_at: null,
        due_at: '2030-01-01T00:00:00Z', status: 'scheduled', revision: 'other-revision'},
    ],
    notes_push_devices: [
      {id: OWNER_DEVICE, user_id: OWNER, endpoint: subscription('owner').endpoint,
        subscription: subscription('owner')},
      {id: OTHER_DEVICE, user_id: OTHER, endpoint: subscription('other').endpoint,
        subscription: subscription('other')},
    ],
    notes_push_deliveries: [],
  };
}

async function harness(options = {}) {
  const events = [];
  const sent = [];
  const data = fixtures();
  let handler;
  function query(table) {
    let operation = 'select', payload, columns = '*', max = Infinity, singular = false;
    const filters = [];
    const builder = {
      select(value) { columns = value; return this; },
      eq(column, value) { filters.push([column, value]); return this; },
      is(column, value) { filters.push([column, value]); return this; },
      order() { return this; },
      limit(value) { max = value; return this; },
      single() { singular = true; return this; },
      maybeSingle() { singular = true; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      upsert(value) { operation = 'upsert'; payload = value; return this; },
      delete() { operation = 'delete'; return this; },
      then(resolve, reject) {
        const event = {kind: 'query', table, operation, filters: copy(filters), payload: copy(payload)};
        events.push(event);
        if (!(table in data)) return Promise.reject(new Error(`Unexpected table: ${table}`)).then(resolve, reject);
        let rows = data[table].filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, max);
        if (operation === 'select' && columns !== '*') {
          const names = columns.split(',');
          rows = rows.map(row => Object.fromEntries(names.map(name => [name, row[name]])));
        }
        return Promise.resolve({data: singular ? copy(rows[0] || null) : copy(rows), error: null}).then(resolve, reject);
      },
    };
    return builder;
  }
  function createClient(url, key, clientOptions) {
    const client = key === SERVICE_KEY ? 'service' : key === ANON_KEY ? 'user' : 'unknown';
    events.push({kind: 'client', client, url, options: copy(clientOptions)});
    assert.notEqual(client, 'unknown', 'Only mock keys may be used');
    if (client === 'user') return {
      async rpc(name) {
        events.push({kind: 'rpc', client, name});
        assert.equal(name, 'personal_app_access');
        return copy(options.access === undefined ? {
          data: {allowed: true, reason: 'authorized', active_devices: 1, max_devices: 3}, error: null,
        } : options.access);
      },
    };
    return {
      auth: {async getUser(token) {
        events.push({kind: 'auth', token});
        return options.invalidToken ? {data: {user: null}, error: {message: 'invalid'}} :
          {data: {user: {id: options.authUser || OWNER}}, error: null};
      }},
      from: query,
      async rpc(name) {
        events.push({kind: 'rpc', client, name});
        assert.equal(name, 'claim_notes_reminders');
        // Deliberately return another owner's row, as a legacy claim might.
        return {data: copy(data.notes_reminders), error: null};
      },
    };
  }
  const webpush = {
    generateVAPIDKeys() { throw new Error('Unexpected VAPID generation'); },
    async sendNotification(target, payload) {
      // Recording only; this mock never imports or calls a push provider.
      sent.push({target: copy(target), payload: JSON.parse(payload)});
    },
  };
  const environment = {
    SUPABASE_URL: 'https://isolated.invalid', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    SUPABASE_ANON_KEY: options.missingAnonKey ? undefined : ANON_KEY,
  };
  const context = vm.createContext({
    URL, Request, Response, Headers, crypto: globalThis.crypto,
    fetch() { throw new Error('Network is forbidden in this test'); },
    Deno: {env: {get: name => environment[name]}, serve: callback => { handler = callback; }},
  });
  const module = new vm.SourceTextModule(code, {context, identifier: sourcePath});
  await module.link(specifier => {
    if (specifier === 'npm:@supabase/supabase-js@2.57.4') {
      return new vm.SyntheticModule(['createClient'], function () {
        this.setExport('createClient', createClient);
      }, {context});
    }
    if (specifier === 'npm:web-push@3.6.7') {
      return new vm.SyntheticModule(['default'], function () {
        this.setExport('default', webpush);
      }, {context});
    }
    throw new Error(`Unmocked import is forbidden: ${specifier}`);
  });
  await module.evaluate();
  assert.equal(typeof handler, 'function', 'The handler must register successfully');
  async function request(body, {token = TOKEN, cron, method = 'POST'} = {}) {
    const headers = {'Content-Type': 'application/json'};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (cron) headers['x-notes-cron'] = cron;
    return handler(new Request('https://isolated.invalid/functions/v1/notes-reminders', {
      method, headers, ...(method === 'POST' ? {body: JSON.stringify(body)} : {}),
    }));
  }
  return {request, events, sent};
}

const operations = h => h.events.filter(event => event.kind !== 'client');

test('Both public share actions are refused before any auth, database or push operation', async () => {
  for (const action of ['share-open', 'share-create']) {
    for (const token of ['', TOKEN]) {
      const h = await harness();
      const response = await h.request({action, token: 'dummy-share-token', note: 'dummy'}, {token});
      assert.equal(response.status, 403);
      assert.equal(typeof (await response.json()).error, 'string');
      assert.deepEqual(operations(h), []);
      assert.deepEqual(h.sent, []);
    }
  }
  const h = await harness();
  assert.equal((await h.request(undefined, {method: 'GET', token: ''})).status, 405);
  assert.deepEqual(operations(h), []);
});

test('No token, invalid tokens and another account cannot reach privileged data', async () => {
  const cases = [
    {options: {}, token: '', status: 401},
    {options: {invalidToken: true}, token: TOKEN, status: 401},
    {options: {authUser: OTHER}, token: TOKEN, status: 403},
  ];
  for (const sample of cases) {
    const h = await harness(sample.options);
    const response = await h.request({action: 'list', user_id: OWNER, owner: OWNER}, {token: sample.token});
    assert.equal(response.status, sample.status);
    assert.equal(h.events.some(e => e.kind === 'query' || e.kind === 'rpc'), false);
    assert.deepEqual(h.sent, []);
  }
});

test('Owner access fails closed when the public key or session authorization is unavailable or denied', async () => {
  const cases = [
    {options: {missingAnonKey: true}, status: 503},
    {options: {access: {data: null, error: {code: 'missing-rpc'}}}, status: 503},
    {options: {access: {data: null, error: null}}, status: 503},
    {options: {access: {data: {allowed: false, reason: 'session_revoked'}, error: null}}, status: 403},
    {options: {access: {data: {allowed: true, reason: 'device_limit'}, error: null}}, status: 403},
    {options: {access: {data: {allowed: 'true', reason: 'authorized'}, error: null}}, status: 403},
  ];
  for (const sample of cases) {
    const h = await harness(sample.options);
    assert.equal((await h.request({action: 'list'})).status, sample.status);
    assert.equal(h.events.some(e => e.kind === 'query'), false, 'No privileged table request after a failed gate');
    assert.deepEqual(h.sent, []);
  }
});

test('An approved owner uses their JWT for the RPC and sees only their own reminders and endpoints', async () => {
  const h = await harness();
  const response = await h.request({action: 'list'});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.reminders.map(row => row.id), [OWN_REMINDER]);
  assert.deepEqual(body.endpoints, [subscription('owner').endpoint]);
  assert.equal(body.devices, 1);
  const userClient = h.events.find(e => e.kind === 'client' && e.client === 'user');
  assert.equal(userClient.options.global.headers.Authorization, `Bearer ${TOKEN}`);
  const gate = h.events.findIndex(e => e.kind === 'rpc' && e.client === 'user');
  assert.ok(gate > h.events.findIndex(e => e.kind === 'auth'));
  assert.ok(h.events.findIndex(e => e.kind === 'query') > gate);
  assert.equal(h.events.some(e => e.kind === 'rpc' && e.client === 'service'), false);
  assert.deepEqual(h.sent, []);
});

test('Dispatch with a missing or incorrect cron secret cannot claim reminders or send push notifications', async () => {
  for (const cron of [undefined, 'incorrect-test-secret']) {
    const h = await harness();
    assert.equal((await h.request({action: 'dispatch'}, {token: '', cron})).status, 401);
    assert.equal(h.events.some(e => e.kind === 'rpc'), false);
    assert.deepEqual(h.sent, []);
    assert.equal(h.events.some(e => e.kind === 'query' && e.operation !== 'select'), false);
  }
});

test('Dispatch filters a mixed legacy claim and sends only to owner devices', async () => {
  const h = await harness();
  const response = await h.request({action: 'dispatch'}, {token: '', cron: CRON_SECRET});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {delivered: 1});
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].target.endpoint, subscription('owner').endpoint);
  assert.equal(h.sent[0].payload.id, OWN_REMINDER);
  const writes = h.events.filter(e => e.kind === 'query' && e.operation !== 'select');
  assert.equal(writes.some(e => e.payload?.device_id === OTHER_DEVICE || e.payload?.reminder_id === OTHER_REMINDER), false);
  const reminderWrites = writes.filter(e => e.table === 'notes_reminders');
  assert.ok(reminderWrites.length > 0);
  for (const write of reminderWrites) {
    assert.ok(write.filters.some(([key, value]) => key === 'user_id' && value === OWNER));
    assert.ok(write.filters.some(([key, value]) => key === 'id' && value === OWN_REMINDER));
  }
});
