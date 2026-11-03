'use strict';
// Test the actual IPC registration code with an Electron test double. No real
// Electron profile, user queue, browser, remote machine or clinical files.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const main=path.resolve(__dirname,'../desktop/main.cjs');

test('actual status IPC uses the read-only status reader and keeps authorization', async t=>{
  const sandbox=await fs.mkdtemp(path.join(os.tmpdir(),'keep-status-ipc-synthetic-'));
  t.after(()=>fs.rm(sandbox,{recursive:true,force:true}));
  const handlers=new Map(), ready=[], sender={getURL:()=> 'notas://app/index.html'};
  class Window {
    constructor(){this.webContents={setWindowOpenHandler(){},on(){},once(){}};}
    loadURL(){}
    static fromWebContents(value){return value===sender?{}:null;}
    static getAllWindows(){return [];}
  }
  const forbidden=()=>{throw Error('External operation must not run in status test');};
  const electron={
    app:{whenReady:()=>({then:fn=>ready.push(fn)}),on(){},requestSingleInstanceLock:()=>true,
      getPath:()=>sandbox,setAsDefaultProtocolClient:forbidden,quit:forbidden},
    BrowserWindow:Window,protocol:{registerSchemesAsPrivileged(){},handle(){}},
    ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},net:{fetch:forbidden},
    shell:{openExternal:forbidden},dialog:{showSaveDialog:forbidden}
  };
  const realRequire=createRequire(main);
  vm.runInNewContext(await fs.readFile(main,'utf8'),{
    require:name=>name==='electron'?electron:realRequire(name),
    __dirname:path.dirname(main),process:{env:{LOCALAPPDATA:sandbox},defaultApp:true,argv:[],platform:'win32'}
  },{filename:main});
  await ready[0]();
  const status=handlers.get('notas:keep-status'), queue=handlers.get('notas:keep-queue');
  assert.equal(typeof status,'function');
  const absent=await status({sender},'a'.repeat(32));
  assert.equal(absent.state,'not_found');
  await assert.rejects(status({sender:{getURL:()=> 'https://example.invalid'}},'a'.repeat(32)),/não autorizado/);
  await assert.rejects(status({sender},'../arbitrary'),/não autorizado/);
  const ticket=await queue({sender},{mode:'guide',reference:'SYNTHETIC-IPC',planning:'',version:'SYNTHETIC-V1',
    status:'unknown',kind:'unknown',notes:'SYNTHETIC ONLY'});
  const pending=await status({sender},ticket.id);
  assert.equal(pending.state,'queued');assert.equal(pending.workerActivity,'missing');
  const agentRoot=path.join(sandbox,'KeepAligner','LocalAgent');
  assert.equal((await fs.readdir(path.join(agentRoot,'inbox'))).length,1);
  await fs.mkdir(path.join(agentRoot,'results'));
  await fs.writeFile(path.join(agentRoot,'results',ticket.id+'.json'),JSON.stringify({
    id:ticket.id,state:'awaiting_visual_review',message:'SYNTHETIC',progress:{step:3,total:3},
    artifactReport:{verified:true,files:Array(9).fill({})},clinicalApproval:true,publishingAuthorized:true,
    request:{notes:'PRIVATE'},stdoutTail:'PRIVATE'
  }));
  const completed=await status({sender},ticket.id);
  assert.equal(completed.state,'awaiting_visual_review');assert.equal(completed.artifactCount,9);
  assert.equal(completed.clinicalApproval,false);assert.equal(completed.publishingAuthorized,false);
  assert.doesNotMatch(JSON.stringify(completed),/PRIVATE/);
  assert.equal((await fs.readdir(path.join(agentRoot,'inbox'))).length,1);
});
