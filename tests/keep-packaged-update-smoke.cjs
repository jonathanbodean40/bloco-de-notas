'use strict';
// Runs the prepared real ASAR with development Electron, a disposable profile,
// and no usable network connection. Never launches the real user profile.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {_electron}=require('playwright');
const repo=path.resolve(__dirname,'..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
let app,sandbox;
(async()=>{
 const candidate=process.env.KEEP_CANDIDATE_ASAR;
 const executable=process.env.KEEP_ELECTRON_TEST_EXE;
 assert(candidate&&path.isAbsolute(candidate)&&candidate.startsWith(path.join(repo,'.runtime')+path.sep));
 assert(executable&&path.isAbsolute(executable));
 const preparation=JSON.parse(fs.readFileSync(path.join(path.dirname(candidate),'preparation.json'),'utf8'));
 assert.equal(sha(candidate),preparation.candidateSha256);
 sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'keep-packaged-update-'));
 const env={...process.env,LOCALAPPDATA:path.join(sandbox,'local')};
 const profile=path.join(sandbox,'profile');
 const report={syntheticOnly:true,productionProfileUsed:false,clinicalApproval:false,publishingAuthorized:false,checks:[]};
 try{
  app=await _electron.launch({executablePath:executable,
   args:[candidate,'--user-data-dir='+profile,'--proxy-server=http://127.0.0.1:9','--proxy-bypass-list=<-loopback>'],env});
  const metadata=await app.evaluate(({app})=>({defaultApp:process.defaultApp,userData:app.getPath('userData'),appPath:app.getAppPath(),electron:process.versions.electron}));
  assert.equal(metadata.defaultApp,true,'Test must never register the production OAuth protocol');
  assert.equal(path.resolve(metadata.userData),path.resolve(profile));
  assert.equal(path.resolve(metadata.appPath),path.resolve(candidate));
  report.electron=metadata.electron;
  const context=app.context();
  await context.route(/^https?:\/\//,route=>route.abort());
  const page=await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(()=>typeof window.NOTAS_DESKTOP?.keepJobStatus==='function');
  report.checks.push('real_asar_starts_with_isolated_profile');
  const absent=await page.evaluate(()=>window.NOTAS_DESKTOP.keepJobStatus('0'.repeat(32)));
  assert.equal(absent.state,'not_found');
  assert.equal(absent.clinicalApproval,false);
  report.checks.push('missing_ticket_is_not_found');
  const localRoot=path.join(env.LOCALAPPDATA,'KeepAligner','LocalAgent');
  fs.mkdirSync(localRoot,{recursive:true});
  fs.writeFileSync(path.join(localRoot,'heartbeat.json'),JSON.stringify({state:'running',timestamp:new Date().toISOString(),pid:12345}));
  const ticket=await page.evaluate(()=>window.NOTAS_DESKTOP.queueKeepJob({mode:'guide',reference:'SYNTHETIC-PACKAGE-ONLY',planning:'',version:'SYNTHETIC-V1',notes:'SYNTHETIC ONLY',status:'unknown',kind:'unknown'}));
  assert.match(ticket.id,/^[a-f0-9]{32}$/);
  const queued=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),ticket.id);
  assert.equal(queued.state,'queued');
  assert.equal(queued.workerActivity,'recent');
  report.checks.push('packaged_ipc_writes_isolated_queue_and_reads_heartbeat');
  fs.writeFileSync(path.join(localRoot,'heartbeat.json'),JSON.stringify({state:'running',timestamp:'2000-01-01T00:00:00Z',pid:12345}));
  const stale=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),ticket.id);
  assert.equal(stale.workerActivity,'stale');
  report.checks.push('stale_worker_warning');
  const python=process.env.LOCAL_AGENT_PYTHON||'python';
  const work=spawnSync(python,[path.join(repo,'executor','agent.py'),'once'],{cwd:repo,env,encoding:'utf8',timeout:20000});
  assert.equal(work.status,0,work.stderr);
  const final=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),ticket.id);
  assert.equal(final.state,'awaiting_case_data');
  assert.equal(final.clinicalApproval,false);
  assert.equal(final.publishingAuthorized,false);
  assert.equal(final.artifactCount,0);
  assert.equal(fs.readdirSync(path.join(localRoot,'inbox')).filter(n=>n.endsWith('.json')).length,0);
  report.checks.push('packaged_ipc_python_executor_result_no_clinical_generator');
  report.passed=true;
  report.candidateSha256=sha(candidate);
  report.originalInstalledArchiveUnchanged=sha(preparation.installedArchive)===preparation.originalSha256;
  assert.equal(report.originalInstalledArchiveUnchanged,true);
  report.checkedAt=new Date().toISOString();
  fs.writeFileSync(path.join(path.dirname(candidate),'packaged-test.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
 }finally{
  if(app)await app.close();
  if(sandbox)fs.rmSync(sandbox,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
