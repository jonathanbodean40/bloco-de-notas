'use strict';
// Synthetic IPC test. Uses separate Electron profile and no real clinical files.
const {_electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs');
(async()=>{
 const executablePath=path.resolve(__dirname,'../dist-installers/win-unpacked/Bloco de Notas Pro.exe');
 const app=await _electron.launch({executablePath,args:['--user-data-dir='+path.resolve(__dirname,'../.runtime/keep-queue-smoke-profile')]});
 try{
  const page=await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(()=>typeof window.NOTAS_DESKTOP?.queueKeepJob==='function');
  const response=await page.evaluate(()=>window.NOTAS_DESKTOP.queueKeepJob({
   mode:'guide',reference:'TESTE-KEEP-EXECUTOR-SEM-PACIENTE',
   planning:'',status:'unknown',kind:'unknown',version:'test',notes:'Apenas um teste de integração.'
  }));
  if(!/^[a-f0-9]{32}$/.test(response.id))throw Error('Invalid queue ticket');
  let state;
  for(let i=0;i<20;i++){
   await page.waitForTimeout(1000);
   state=await page.evaluate(id=>window.NOTAS_DESKTOP.keepJobStatus(id),response.id);
   if(state.state!=='queued')break;
  }
  if(state?.state!=='awaiting_case_data')throw Error('Unexpected worker result: '+JSON.stringify(state));
  const base=path.join(process.env.LOCALAPPDATA,'KeepAligner','LocalAgent','results');
  const file=path.join(base,response.id+'.json');
  if(fs.existsSync(file))fs.unlinkSync(file);
  console.log('PASS: Windows note app queues synthetic guide via isolated IPC and background worker marks awaiting case data.');
 }finally{await app.close()}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
