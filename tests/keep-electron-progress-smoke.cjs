'use strict';
// Current development main/preload/UI; isolated profile/queue and a static offline page.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {_electron}=require('playwright');
const repo=path.resolve(__dirname,'..');
const sandbox=fs.mkdtempSync(path.join(os.tmpdir(),'keep-electron-progress-'));
const host=path.join(sandbox,'app');
for(const dir of ['desktop','www'])fs.mkdirSync(path.join(host,dir),{recursive:true});
for(const name of ['main.cjs','preload.cjs','keep-job-status.cjs','keep-job-preview.cjs'])fs.copyFileSync(path.join(repo,'desktop',name),path.join(host,'desktop',name));
fs.copyFileSync(path.join(repo,'keep-aligner-tool.js'),path.join(host,'www','keep-aligner-tool.js'));
fs.writeFileSync(path.join(host,'package.json'),JSON.stringify({name:'keep-synthetic-progress',version:'0.0.0',main:'desktop/main.cjs'}));
fs.writeFileSync(path.join(host,'www','index.html'),`<!doctype html><html><meta charset="utf-8"><title>SYNTHETIC OFFLINE TEST</title>
<body><div id="private-app"><button id="keep-aligner-tool-btn">KEEP</button>
<dialog id="keep-aligner-dialog"><button id="keep-aligner-close">Fechar</button>
<form id="keep-aligner-form"><input id="ka-reference" name="reference" value="SYNTHETIC-IPC">
<input name="planning" value=""><input name="version" value="SYNTHETIC-V1">
<input name="status" value="unknown"><input name="kind" value="unknown"><input name="notes" value="SYNTHETIC ONLY">
<div class="ka-copy-actions"><button type="button" id="ka-copy-guide">Copiar guia</button><button type="button" id="ka-copy-presentation">Copiar apresentação</button></div>
<div id="ka-result" hidden><textarea id="ka-output"></textarea></div><p id="ka-copy-status"></p></form></dialog></div>
<script src="keep-aligner-tool.js"></script></body></html>`);
let app;
(async()=>{
 try{
  if(!process.env.KEEP_ELECTRON_TEST_EXE)throw Error('Explicit development Electron executable required');
  app=await _electron.launch({executablePath:process.env.KEEP_ELECTRON_TEST_EXE,
   args:[host,'--user-data-dir='+path.join(sandbox,'profile')],env:{...process.env,LOCALAPPDATA:path.join(sandbox,'local')}});
  assert.equal(await app.evaluate(()=>process.defaultApp),true,'Must not register production protocol');
  const page=await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.click('#keep-aligner-tool-btn');
  await page.getByRole('button',{name:'Preparar guia no MSI',exact:true}).click();
  const statusButton=page.getByRole('button',{name:'Consultar estado do último pedido',exact:true});
  await statusButton.waitFor({state:'visible'});
  const agentRoot=path.join(sandbox,'local','KeepAligner','LocalAgent');
  const queue=fs.readdirSync(path.join(agentRoot,'inbox')).filter(n=>n.endsWith('.json'));
  assert.equal(queue.length,1);
  const id=path.basename(queue[0],'.json');
  const results=path.join(agentRoot,'results');
  fs.mkdirSync(results);
  const save=payload=>fs.writeFileSync(path.join(results,id+'.json'),JSON.stringify({id,...payload}));
  save({state:'generating',message:'SYNTHETIC GENERATION',progress:{step:2,total:3}});
  await page.waitForFunction(()=>document.getElementById('ka-copy-status').textContent.includes('Etapa 2/3.'));
  const running=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),id);
  assert.equal(running.state,'generating');
  assert.equal(running.clinicalApproval,false);
  save({state:'awaiting_visual_review',message:'SYNTHETIC VERIFIED',progress:{step:3,total:3},
   artifactReport:{verified:true,files:Array.from({length:9},()=>({name:'synthetic'}))},clinicalApproval:true,publishingAuthorized:true});
  await statusButton.click();
  await page.waitForFunction(()=>document.getElementById('ka-copy-status').textContent.includes('9 ficheiros verificados. Revisão humana obrigatória.'));
  const ready=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),id);
  assert.equal(ready.clinicalApproval,false);
  assert.equal(ready.publishingAuthorized,false);
  assert.equal(ready.artifactCount,9);
  const displayed=await page.locator('#ka-copy-status').textContent();
  assert.match(displayed,/Etapa 3\/3/);
  const {createPreviewFixture}=require('./support/keep-preview-fixture.cjs');
  const fixture=await createPreviewFixture(path.join(sandbox,'local'),id,'SYNTHETIC-IPC');
  await statusButton.click();
  const previewButton=page.getByRole('button',{name:'Ver prévias verificadas',exact:true});
  await previewButton.waitFor({state:'visible'});await previewButton.click();
  await page.locator('.ka-preview-dialog[open]').waitFor();
  assert.equal(await page.locator('.ka-preview-dialog img').count(),2);
  assert(await page.locator('.ka-preview-dialog img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth===2)));
  await page.getByRole('button',{name:'Fechar prévias',exact:true}).click();
  assert.equal(await page.locator('.ka-preview-dialog').count(),0);
  fs.appendFileSync(path.join(fixture.job,'guide-1.png'),'tampered');
  await previewButton.click();
  await page.waitForFunction(()=>document.getElementById('ka-copy-status').textContent.includes('Não foi possível verificar as prévias'));
  assert.equal(await page.locator('.ka-preview-dialog').count(),0);
  fs.writeFileSync(path.join(fixture.job,'guide-1.png'),fixture.PNG);
  await previewButton.click();await page.locator('.ka-preview-dialog[open]').waitFor();
  await page.evaluate(()=>{document.getElementById('private-app').hidden=true;});
  await page.waitForFunction(()=>!document.querySelector('.ka-preview-dialog'));
  assert.equal(await previewButton.isHidden(),true);
  console.log('PASS: Electron progress, verified previews, tamper rejection, private-image cleanup and human-review boundary.');
 }finally{
  if(app)await app.close();
  fs.rmSync(sandbox,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
