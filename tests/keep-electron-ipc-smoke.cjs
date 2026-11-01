'use strict';
// Synthetic, isolated Electron IPC test. No live queue, patient files or cloud calls.
const {_electron} = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-ipc-smoke-'));
const env = {...process.env, LOCALAPPDATA: sandbox};
const exe = path.join(root, 'dist-installers', 'win-unpacked', 'Bloco de Notas Pro.exe');
const runner = path.join(root, 'executor', 'agent.py');
let app;
(async () => {
 try {
  app = await _electron.launch({
   executablePath: exe, env,
   args: ['--user-data-dir=' + path.join(sandbox, 'electron-profile')]
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof window.NOTAS_DESKTOP?.queueKeepJob === 'function');
  const response = await page.evaluate(() => window.NOTAS_DESKTOP.queueKeepJob({
   mode: 'guide', reference: 'SYNTHETIC_KEEP_NO_PATIENT',
   planning: '', status: 'unknown', kind: 'unknown', version: 'fictitious',
   notes: 'Apenas teste sintético isolado.'
  }));
  if(!/^[a-f0-9]{32}$/.test(response.id)) throw Error('Ticket inválido');
  const python = process.env.LOCAL_AGENT_PYTHON || 'python';
  const worker = spawnSync(python, [runner, 'once'], {env, cwd: root, encoding: 'utf8', timeout: 20000});
  if(worker.status !== 0) throw Error('Worker sintético falhou: ' + worker.stderr);
  const state = await page.evaluate(id => window.NOTAS_DESKTOP.keepJobStatus(id), response.id);
  if(state.state !== 'awaiting_case_data') throw Error('Estado inesperado: ' + JSON.stringify(state));
  const resultFile = path.join(sandbox, 'KeepAligner', 'LocalAgent', 'results', response.id + '.json');
  if(!fs.existsSync(resultFile)) throw Error('Resultado sintético em falta');
  console.log('PASS: isolated Windows IPC, worker and result; MSI live queue untouched.');
 } finally {
  if(app) await app.close();
  fs.rmSync(sandbox, {recursive:true, force:true});
 }
})().catch(error => {console.error(error.stack); process.exitCode = 1;});
