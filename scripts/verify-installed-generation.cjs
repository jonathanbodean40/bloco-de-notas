'use strict';
// Opt-in full generation acceptance. Actual installed code/worker/generator,
// entirely fictitious inputs, temporary notes profile, network blocked.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron}=require('playwright');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
let application,profile;
(async()=>{
 assert.equal(process.platform,'win32');
 assert.equal(process.argv[2],'--synthetic-generation');
 const receiptPath=process.argv[3];assert(receiptPath&&path.isAbsolute(receiptPath));
 const stage=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
 assert.equal(stage.syntheticOnly,true);assert.equal(stage.enqueued,false);
 assert.match(stage.request.reference,/^keep-mock-SYNTHETIC-PRESENTATION-[a-f0-9]{12}$/);
 assert.equal(stage.request.version,'SYNTHETIC-V1');assert.equal(stage.request.mode,'presentation');
 const root=path.dirname(receiptPath);assert.equal(path.resolve(stage.root),root);
 const marker=path.join(root,'dispatch.json');assert(!fs.existsSync(marker),'Inspect the prior dispatch; never enqueue automatically twice');
 const base=process.env.LOCALAPPDATA,agent=path.join(base,'KeepAligner','LocalAgent');
 assert.equal(fs.readdirSync(path.join(agent,'inbox')).filter(n=>n.endsWith('.json')).length,0);
 const c=JSON.parse(fs.readFileSync(path.join(agent,'cases',stage.request.reference+'.json'),'utf8'));
 assert.equal(c.synthetic_only,true);assert.equal(c.patient,'AMOSTRA FICTICIA');
 const h=JSON.parse(fs.readFileSync(path.join(agent,'heartbeat.json'),'utf8'));
 assert.equal(h.state,'running');assert(Date.now()-Date.parse(h.timestamp)>=0&&Date.now()-Date.parse(h.timestamp)<60000);
 const resources=path.join(base,'Programs','Bloco de Notas Pro','resources'),archive=path.join(resources,'app.asar');
 const deployment=JSON.parse(fs.readFileSync(path.join(resources,'keep-workflow-update.json'),'utf8'));
 assert.equal(sha(fs.readFileSync(archive)),deployment.installedSha256);
 const report={syntheticOnly:true,installedAppCodeUsed:true,existingWorkerUsed:true,notesProfileUsed:false,
  connectedProvidersUsed:false,clinicalApproval:false,publishingAuthorized:false,states:[]};
 profile=fs.mkdtempSync(path.join(os.tmpdir(),'keep-installed-generation-'));
 try{
  assert(process.env.KEEP_ELECTRON_TEST_EXE);
  application=await _electron.launch({executablePath:process.env.KEEP_ELECTRON_TEST_EXE,
   args:[archive,'--user-data-dir='+path.join(profile,'profile'),'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>'],env:{...process.env}});
  const actual=await application.evaluate(({app})=>({isDefault:process.defaultApp,profile:app.getPath('userData'),archive:app.getAppPath()}));
  assert.equal(actual.isDefault,true);assert.equal(path.resolve(actual.profile),path.join(profile,'profile'));
  assert.equal(path.resolve(actual.archive),path.resolve(archive));
  await application.context().route(/^https?:\/\//,r=>r.abort());
  const page=await application.firstWindow();await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(()=>typeof window.NOTAS_DESKTOP?.keepJobPreview==='function');
  fs.writeFileSync(marker,JSON.stringify({state:'dispatch_started',at:new Date().toISOString()}),{flag:'wx'});
  const ticket=await page.evaluate(request=>window.NOTAS_DESKTOP.queueKeepJob(request),stage.request);
  assert.match(ticket.id,/^[a-f0-9]{32}$/);report.ticket=ticket.id;
  fs.writeFileSync(marker,JSON.stringify({state:'queued',ticket:ticket.id}));
  let state;
  for(let i=0;i<150;i++){
   state=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),ticket.id);
   if(report.states.at(-1)!==state.state)report.states.push(state.state);
   if(!['queued','validating_sources','generating','validating_outputs'].includes(state.state))break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(state.state,'awaiting_visual_review',JSON.stringify(state));
  assert.equal(state.artifactCount,9);assert.equal(state.clinicalApproval,false);assert.equal(state.publishingAuthorized,false);
  const preview=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobPreview(id),ticket.id);
  assert.equal(preview.images.length,4);assert.equal(preview.clinicalApproval,false);assert.equal(preview.publishingAuthorized,false);
  const saved=JSON.parse(fs.readFileSync(path.join(agent,'results',ticket.id+'.json'),'utf8'));
  assert.equal(saved.exitCode,0);assert.equal(saved.artifactReport.verified,true);
  assert.equal(saved.request.reference,stage.request.reference);
  report.previewImages=[];
  for(const image of preview.images){
   const bytes=Buffer.from(image.dataUrl.split(',')[1],'base64');
   const source=saved.artifactReport.files.find(f=>f.name===image.name);
   assert(source);assert.equal(sha(bytes),source.sha256);
   fs.writeFileSync(path.join(root,'app-preview-'+image.name),bytes,{flag:'wx'});
   report.previewImages.push({name:image.name,width:image.width,height:image.height,sha256:sha(bytes)});
  }
  assert(!fs.existsSync(path.join(agent,'inbox',ticket.id+'.json')));
  assert.equal(sha(fs.readFileSync(archive)),deployment.installedSha256);
  report.generatorInvoked=true;report.verifiedDocuments=9;report.nativeRendered=saved.artifactReport.nativeRendered;
  report.installedSha256=deployment.installedSha256;report.passed=true;report.checkedAt=new Date().toISOString();
  fs.writeFileSync(path.join(root,'installed-generation-acceptance.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({...report,reportFile:path.join(root,'installed-generation-acceptance.json')},null,2));
 }finally{
  if(application)await application.close();
  if(profile)fs.rmSync(profile,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
