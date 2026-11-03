'use strict';
// Read-only status projection. No case-file reads, enqueue, retry, shell or network.
const fs = require('node:fs/promises');
const path = require('node:path');
const STATES = new Set([
  'queued', 'validating_sources', 'generating', 'validating_outputs',
  'awaiting_case_data', 'awaiting_verified_sources', 'awaiting_integration_validation',
  'awaiting_visual_review', 'blocked'
]);
const ID = /^[a-f0-9]{32}$/;
const MAX_RESULT_BYTES = 512 * 1024;

async function regularFile(root, folder, name) {
  const parent = folder ? path.join(root, folder) : root;
  for (const dir of new Set([root, parent])) {
    const info = await fs.lstat(dir);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid status directory');
  }
  const target = path.join(parent, name);
  const info = await fs.lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Invalid status file');
  return {target, info};
}

async function readObject(root, folder, name, limit = MAX_RESULT_BYTES) {
  let handle;
  try {
    const {target, info} = await regularFile(root, folder, name);
    if (info.size > limit) throw new Error('Status record too large');
    handle = await fs.open(target, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit || opened.ino !== info.ino || opened.dev !== info.dev)
      throw new Error('Status record changed while opening');
    // Bounded even if another process grows the file after stat().
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('Status record too large');
    const value = JSON.parse(buffer.subarray(0, length).toString('utf8').replace(/^\uFEFF/, ''));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid status record');
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  } finally {
    if (handle) await handle.close();
  }
}

function projectResult(id, payload) {
  if (payload.id !== id) throw new Error('Status identity mismatch');
  const recognised = STATES.has(payload.state);
  const state = recognised ? payload.state : 'blocked';
  const p = payload.progress;
  const progress = p && Number.isInteger(p.step) && p.step >= 1 && p.step <= 3 && p.total === 3
    ? {step: p.step, total: 3} : null;
  const report = payload.artifactReport;
  const artifactCount = state === 'awaiting_visual_review' && report?.verified === true
    && Array.isArray(report.files) && report.files.length <= 32 ? report.files.length : 0;
  return {
    id, state,
    message: recognised && typeof payload.message === 'string'
      ? payload.message.slice(0, 300) : 'Estado técnico inválido; confirmar o executor sem reenviar o pedido.',
    progress, artifactCount, clinicalApproval: false, publishingAuthorized: false
  };
}

async function heartbeatActivity(root, now) {
  try {
    const record = await readObject(root, '', 'heartbeat.json', 16 * 1024);
    if (!record) return 'missing';
    if (record.state !== 'running' || typeof record.timestamp !== 'string'
        || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(record.timestamp)) return 'invalid';
    const timestamp = Date.parse(record.timestamp);
    const age = now - timestamp;
    if (!Number.isFinite(age) || age < 0) return 'invalid';
    return age <= 60000 ? 'recent' : 'stale';
  } catch { return 'unavailable'; }
}

async function getKeepJobStatus(root, id, now = Date.now()) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || typeof id !== 'string' || !ID.test(id))
    throw new Error('Pedido não autorizado');
  try {
    const first = await readObject(root, 'results', id + '.json');
    if (first) return projectResult(id, first);
    let queued = false;
    try { await regularFile(root, 'inbox', id + '.json'); queued = true; }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    // Worker atomically saves the result, then removes the inbox file. Re-read
    // the result to avoid a false not_found during that normal transition.
    const second = await readObject(root, 'results', id + '.json');
    if (second) return projectResult(id, second);
    const base = {id, progress: null, artifactCount: 0, clinicalApproval: false, publishingAuthorized: false};
    if (!queued) return {...base, state: 'not_found',
      message: 'Pedido não encontrado na fila nem nos resultados. Não foi reenviado automaticamente.'};
    const workerActivity = await heartbeatActivity(root, now);
    return {...base, state: 'queued', workerActivity,
      message: workerActivity === 'recent'
        ? 'Pedido guardado na fila; há sinal recente do executor. A geração ainda não foi confirmada.'
        : 'Pedido guardado na fila, mas sem sinal recente confirmado do executor. Verificar o serviço; não reenviar.'};
  } catch {
    // Do not expose paths, raw result data or underlying filesystem errors.
    throw new Error('Não foi possível consultar o executor');
  }
}

module.exports = {getKeepJobStatus};
