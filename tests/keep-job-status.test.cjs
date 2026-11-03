'use strict';
// Every filesystem operation is confined to an ephemeral synthetic directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {getKeepJobStatus} = require('../desktop/keep-job-status.cjs');
const ID = 'a'.repeat(32), OTHER = 'b'.repeat(32);
const NOW = Date.parse('2026-11-03T16:00:00Z');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keep-status-synthetic-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  await fs.mkdir(path.join(root,'inbox'));
  await fs.mkdir(path.join(root,'results'));
  const write = (name, value) => fs.writeFile(path.join(root,name), JSON.stringify(value));
  const result = (value = {}) => write('results/'+ID+'.json', {id:ID,state:'awaiting_visual_review',message:'SYNTHETIC',...value});
  // Deliberately invalid JSON proves that queue contents need not be read.
  const queued = () => fs.writeFile(path.join(root,'inbox',ID+'.json'), 'DO NOT PARSE SYNTHETIC QUEUE CONTENT');
  return {root,write,result,queued,check:()=>getKeepJobStatus(root,ID,NOW)};
}

async function assertNoApproval(value) {
  assert.equal(value.clinicalApproval,false);
  assert.equal(value.publishingAuthorized,false);
}

test('nonexistent ticket is not reported as queued and creates no files', async t => {
  const f=await fixture(t), value=await f.check();
  assert.equal(value.state,'not_found');
  assert.deepEqual(await fs.readdir(path.join(f.root,'inbox')),[]);
  assert.deepEqual(await fs.readdir(path.join(f.root,'results')),[]);
  await assertNoApproval(value);
});

test('absent installation is not reported as queued and is not created', async t => {
  const f=await fixture(t), missing=path.join(f.root,'absent');
  assert.equal((await getKeepJobStatus(missing,ID,NOW)).state,'not_found');
  await assert.rejects(fs.stat(missing),{code:'ENOENT'});
});

for (const [name,record,expected] of [
  ['missing',null,'missing'],
  ['recent',{state:'running',timestamp:'2026-11-03T15:59:58Z'},'recent'],
  ['boundary',{state:'running',timestamp:'2026-11-03T15:59:00Z'},'recent'],
  ['stale',{state:'running',timestamp:'2026-11-03T15:58:59Z'},'stale'],
  ['future',{state:'running',timestamp:'2026-11-03T16:01:00Z'},'invalid'],
  ['invalid timestamp',{state:'running',timestamp:'nonsense'},'invalid'],
  ['missing timezone',{state:'running',timestamp:'2026-11-03T15:59:58'},'invalid'],
  ['stopped',{state:'stopped',timestamp:'2026-11-03T15:59:58Z'},'invalid']
]) test('queued ticket reports '+name+' heartbeat without reading queue contents', async t=>{
  const f=await fixture(t); await f.queued();
  if(record) await f.write('heartbeat.json',record);
  const before=await fs.readFile(path.join(f.root,'inbox',ID+'.json'));
  const value=await f.check();
  assert.equal(value.state,'queued'); assert.equal(value.workerActivity,expected);
  assert.equal(value.artifactCount,0); await assertNoApproval(value);
  if(expected!=='recent') assert.match(value.message,/sem sinal recente/);
  assert.deepEqual(await fs.readFile(path.join(f.root,'inbox',ID+'.json')),before);
});

test('malformed heartbeat warns without hiding a queued job', async t=>{
  const f=await fixture(t); await f.queued();
  await fs.writeFile(path.join(f.root,'heartbeat.json'),'{malformed');
  assert.equal((await f.check()).workerActivity,'unavailable');
});

test('result wins over inbox, even when the worker is no longer active', async t=>{
  const f=await fixture(t); await f.queued(); await f.result();
  assert.equal((await f.check()).state,'awaiting_visual_review');
});

test('read-back exposes no case, credentials, paths or logs and no approvals', async t=>{
  const f=await fixture(t); await f.result({clinicalApproval:true,publishingAuthorized:true,
    request:{reference:'PRIVATE-SYNTHETIC'},stdoutTail:'SECRET-SYNTHETIC',stderrTail:'HIDDEN',
    artifactReport:{verified:true,jobDirectory:'PRIVATE-PATH',files:Array(9).fill({name:'PRIVATE'})},
    progress:{step:3,total:3,private:'SYNTHETIC'}});
  const value=await f.check();
  assert.equal(value.artifactCount,9); assert.deepEqual(value.progress,{step:3,total:3});
  await assertNoApproval(value);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE|SECRET|HIDDEN/);
});

for(const state of ['validating_sources','generating','validating_outputs'])
  test(state+' remains in progress despite missing heartbeat', async t=>{
    const f=await fixture(t); await f.result({state,progress:{step:2,total:3}});
    assert.equal((await f.check()).state,state);
  });

test('unknown completion or publication state is blocked', async t=>{
  const f=await fixture(t); await f.result({state:'published',message:'SUCCESS'});
  const value=await f.check();assert.equal(value.state,'blocked');
  assert.doesNotMatch(value.message,/SUCCESS/);await assertNoApproval(value);
});

test('different result identity is rejected without exposing raw details', async t=>{
  const f=await fixture(t); await f.result({id:OTHER});
  await assert.rejects(f.check(),{message:'Não foi possível consultar o executor'});
});

test('corrupt result is not silently reported as queued', async t=>{
  const f=await fixture(t);await f.queued();
  await fs.writeFile(path.join(f.root,'results',ID+'.json'),'{bad');
  await assert.rejects(f.check(),{message:'Não foi possível consultar o executor'});
});

test('oversized result is rejected', async t=>{
  const f=await fixture(t);await f.result({message:'x'.repeat(512*1024)});
  await assert.rejects(f.check(),{message:'Não foi possível consultar o executor'});
});

test('invalid progress and oversized artifact collection are not trusted', async t=>{
  const f=await fixture(t);await f.result({progress:{step:99,total:3},artifactReport:{verified:true,files:Array(33).fill({})}});
  const value=await f.check();assert.equal(value.progress,null);assert.equal(value.artifactCount,0);
});

test('blocked result cannot announce verified artifacts', async t=>{
  const f=await fixture(t);await f.result({state:'blocked',artifactReport:{verified:true,files:[{}]}});
  assert.equal((await f.check()).artifactCount,0);
});

test('message is bounded and primitive types are enforced', async t=>{
  const f=await fixture(t);await f.result({message:'x'.repeat(1000)});
  assert.equal((await f.check()).message.length,300);
  await f.result({message:{untrusted:'object'}});assert.equal(typeof (await f.check()).message,'string');
});

test('invalid ticket cannot select an arbitrary file', async t=>{
  const f=await fixture(t);
  for(const id of ['../heartbeat','C:\\case','a'.repeat(31),{},null,ID+'\n'])
    await assert.rejects(getKeepJobStatus(f.root,id,NOW),{message:'Pedido não autorizado'});
});

test('symlink result cannot be used as a local status record', async t=>{
  const f=await fixture(t);await f.write('elsewhere.json',{id:ID,state:'queued'});
  try {await fs.symlink(path.join(f.root,'elsewhere.json'),path.join(f.root,'results',ID+'.json'),'file');}
  catch(error){if(['EPERM','ENOTSUP','EACCES'].includes(error.code)){t.skip('Windows account cannot create symlinks');return;}throw error;}
  await assert.rejects(f.check(),{message:'Não foi possível consultar o executor'});
});

test('result appearing while inbox is inspected wins over missing status', async t=>{
  const f=await fixture(t), original=fs.lstat;
  t.mock.method(fs,'lstat',async function(target,...args){
    if(target===path.join(f.root,'inbox',ID+'.json')) await f.result();
    return original.call(this,target,...args);
  });
  assert.equal((await f.check()).state,'awaiting_visual_review');
});
