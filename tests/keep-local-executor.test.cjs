'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'executor', 'agent.py');
const python = process.env.LOCAL_AGENT_PYTHON || 'python';

// IMPORTANT: every test command uses a fresh, isolated LOCALAPPDATA.
// Never run 'once' against the MSI's live queue or clinical case files.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-agent-test-'));
const agentRoot = path.join(sandbox, 'KeepAligner', 'LocalAgent');
const env = { ...process.env, LOCALAPPDATA: sandbox };
const run = args => spawnSync(python, [runner, ...args], {
  cwd: root, env, encoding: 'utf8', timeout: 20000
});
try {
  let r = run(['health']);
  assert.equal(r.status, 0, r.stderr);
  const h = JSON.parse(r.stdout);
  assert.equal(h.publishingEnabled, false);
  assert.equal(h.automaticCodexCalls, false);
  assert.equal(h.inbox, path.join(agentRoot, 'inbox'));
  assert.equal(h.workerOnline, false);
  assert.equal(h.queueDepth, 0);
  assert.equal(h.resultCount, 0);

  r = run(['enqueue', '--request', path.join(sandbox, 'missing.json')]);
  assert.notEqual(r.status, 0);

  const request = path.join(sandbox, 'synthetic-request.json');
  fs.writeFileSync(request, JSON.stringify({
    mode: 'guide', reference: 'synthetic_test_001',
    status: 'unknown', kind: 'unknown', notes: 'FICTICIO', version: ''
  }));
  r = run(['enqueue', '--request', request]);
  assert.equal(r.status, 0, r.stderr);
  const ticket = JSON.parse(r.stdout).id;
  assert.match(ticket, /^[a-f0-9]{32}$/);
  assert.equal(JSON.parse(run(['health']).stdout).queueDepth, 1);
  r = run(['once']);
  assert.equal(r.status, 0, r.stderr);
  const record = JSON.parse(r.stdout).find(e => e.id === ticket);
  assert(record);
  assert.equal(record.state, 'awaiting_case_data');
  assert.equal(record.exitCode, undefined);
  const result = path.join(agentRoot, 'results', ticket + '.json');
  assert(fs.existsSync(result));
  assert(!fs.existsSync(path.join(agentRoot, 'inbox', ticket + '.json')));
  let status = JSON.parse(run(['health']).stdout);
  assert.equal(status.queueDepth, 0);
  assert.equal(status.resultCount, 1);
  fs.writeFileSync(path.join(agentRoot, 'heartbeat.json'), JSON.stringify({
    state: 'running', timestamp: new Date().toISOString(), pid: 12345
  }));
  status = JSON.parse(run(['health']).stdout);
  assert.equal(status.workerOnline, true);
  fs.writeFileSync(path.join(agentRoot, 'heartbeat.json'), JSON.stringify({
    state: 'running', timestamp: '2000-01-01T00:00:00+00:00', pid: 12345
  }));
  status = JSON.parse(run(['health']).stdout);
  assert.equal(status.workerOnline, false);
  console.log('PASS: synthetic isolated queue, worker heartbeat monitoring, no generator or publication.');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}
