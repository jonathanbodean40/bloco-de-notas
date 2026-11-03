'use strict';
// Explicit opt-in synthetic probe through installed app code and the existing worker.
// Separate note profile, blocked network, no generator, no platform or clinical writes.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {_electron}=require('playwright');
const repo=path.resolve(__dirname,'..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let application,profileRoot;
(async()=>{
 if(process.argv[2]!=='--synthetic-probe')throw Error('Explicit --synthetic-probe is required');
 assert.equal(process.platform,'win32');
 const base=process.env.LOCALAPPDATA;
 assert(base&&path.isAbsolute(base));
 const resources=path.join(base,'Programs','Bloco de Notas Pro','resources');
 const archive=path.join(resources,'app.asar');
 const deployment=JSON.parse(fs.readFileSync(path.join(resources,'keep-workflow-update.json'),'utf8'));
 assert.equal(sha(archive),deployment.installedSha256);
 const agent=path.join(base,'KeepAligner','LocalAgent');
 assert.equal(fs.readdirSync(path.join(agent,'inbox')).filter(n=>n.endsWith('.json')).length,0,'Queue must be empty before this probe');
 const token='SYNTHETIC-HOTFIX-'+crypto.randomBytes(8).toString('hex');
 assert(!fs.existsSync(path.join(agent,'cases',token+'.json')),'Probe cannot target a prepared case');
 const heartbeat=JSON.parse(fs.readFileSync(path.join(agent,'heartbeat.json'),'utf8'));
 assert.equal(heartbeat.state,'running');
 assert(Date.now()-Date.parse(heartbeat.timestamp)>=0&&Date.now()-Date.parse(heartbeat.timestamp)<60000,'Fresh worker heartbeat required');
 profileRoot=fs.mkdtempSync(path.join(os.tmpdir(),'keep-installed-probe-'));
 const report={syntheticOnly:true,installedCodeUsed:true,existingWorkerUsed:true,notesProfileUsed:false,clinicalApproval:false,publishingAuthorized:false,installedSha256:deployment.installedSha256};
 try{
  assert(process.env.KEEP_ELECTRON_TEST_EXE,'Explicit development Electron required to avoid protocol registration');
  application=await _electron.launch({executablePath:process.env.KEEP_ELECTRON_TEST_EXE,
   args:[archive,'--user-data-dir='+path.join(profileRoot,'profile'),'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>'],env:{...process.env}});
  const actual=await application.evaluate(({app})=>({isDefault:process.defaultApp,profile:app.getPath('userData'),archive:app.getAppPath()}));
  assert.equal(actual.isDefault,true);
  assert.equal(path.resolve(actual.profile),path.join(profileRoot,'profile'));
  assert.equal(path.resolve(actual.archive),path.resolve(archive));
  await application.context().route(/^https?:\/\//,r=>r.abort());
  const page=await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(()=>typeof window.NOTAS_DESKTOP?.queueKeepJob==='function');
  const missing=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),crypto.randomBytes(16).toString('hex'));
  assert.equal(missing.state,'not_found');
  const ticket=await page.evaluate(reference=>window.NOTAS_DESKTOP.queueKeepJob({reference,mode:'guide',planning:'',version:'SYNTHETIC-V1',status:'unknown',kind:'unknown',notes:'SYNTHETIC DEPLOYMENT CHECK ONLY'}),token);
  assert.match(ticket.id,/^[a-f0-9]{32}$/);
  report.ticket=ticket.id;
  report.states=[];
  let result;
  for(let i=0;i<35;i++){
   result=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),ticket.id);
   if(report.states.at(-1)!==result.state)report.states.push(result.state);
   if(result.state!=='queued')break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(result.state,'awaiting_case_data','The actual worker must process only the synthetic missing-case ticket');
  assert.equal(result.clinicalApproval,false);
  assert.equal(result.publishingAuthorized,false);
  assert.equal(result.artifactCount,0);
  assert(!fs.existsSync(path.join(agent,'inbox',ticket.id+'.json')));
  const saved=JSON.parse(fs.readFileSync(path.join(agent,'results',ticket.id+'.json'),'utf8'));
  assert.equal(saved.request.reference,token);
  assert.equal(saved.exitCode,undefined,'Clinical generator must not run');
  assert.equal(sha(archive),deployment.installedSha256);
  report.generatorInvoked=false;
  report.passed=true;
  report.checkedAt=new Date().toISOString();
  const reportFile=path.join(repo,'.runtime','installed-workflow-probe-'+ticket.id+'.json');
  fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({...report,reportFile},null,2));
 }finally{
  if(application)await application.close();
  if(profileRoot)fs.rmSync(profileRoot,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
