'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const {start}=require('./support/keep-aligner-preview.cjs');

(async()=>{
 const server=await start(0);
 let browser;
 try{
   browser=await chromium.launch({channel:'chrome',headless:true});
   const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 16; POCO F8 Ultra) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'});
   const base='http://127.0.0.1:'+server.address().port;
   const bootstrap=fs.readFileSync(path.join(__dirname,'support/keep-aligner-preview-bootstrap.js'),'utf8');
   await context.route('**/*',route=>{
     const url=new URL(route.request().url());
     if(url.origin!==base)return route.abort();
     if(url.pathname==='/private-access.js'){
       const mock="window.__cloud={from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})}),upsert:async()=>({error:null})})};";
       return route.fulfill({contentType:'text/javascript',body:mock+bootstrap.replace('client: null','client: window.__cloud')});
     }
     return route.continue();
   });
   const page=await context.newPage();
   await page.goto(base+'/?scope=keep-tool-demo');
   await page.locator('#sidebar.active').waitFor();
   await page.evaluate(()=>document.documentElement.classList.add('native-android'));
   const home=await page.evaluate(()=>{
     const event=new Event('notas:android-back',{cancelable:true});
     window.dispatchEvent(event);
     return {prevented:event.defaultPrevented,sidebar:document.querySelector('#sidebar').classList.contains('active')};
   });
   assert.equal(home.prevented,false,'Back on notes home should allow native App.exitApp()');
   await page.goto(base+'/?note=keep-demo-note&scope=keep-tool-demo');
   await page.locator('.note-editor').waitFor();
   await page.evaluate(()=>document.documentElement.classList.add('native-android'));
   await page.locator('[data-window="menu"]').first().click();
   const menu=await page.evaluate(()=>{
     const event=new Event('notas:android-back',{cancelable:true});
     window.dispatchEvent(event);
     return {prevented:event.defaultPrevented,hidden:document.querySelector('#custom-context-menu').hidden};
   });
   assert(menu.prevented && menu.hidden,'Back must dismiss formatting menu');
   const returning=page.waitForURL(u=>!new URL(u).searchParams.has('note'),{timeout:15000});
   const note=await page.evaluate(()=>{
     const event=new Event('notas:android-back',{cancelable:true});
     window.dispatchEvent(event);
     return {prevented:event.defaultPrevented};
   });
   assert.equal(note.prevented,true,'Back in note should not exit directly');
   await returning;
   await page.locator('#sidebar.active').waitFor();

   await page.goto(base+'/?note=keep-demo-note&scope=keep-tool-demo');
   await page.evaluate(()=>document.documentElement.classList.add('native-android'));
   const dirtyEditor=page.locator('.note-editor');
   await dirtyEditor.waitFor();
   await dirtyEditor.fill('Rascunho fictício guardado com o botão Voltar.');
   const returnFromDirty=page.waitForURL(u=>!new URL(u).searchParams.has('note'),{timeout:15000});
   // Schedule the navigation after evaluate() returns; closing/reloading the
   // current WebView during a synchronous evaluation can cancel Playwright IPC.
   await page.evaluate(()=>setTimeout(()=>{
     window.dispatchEvent(new Event('notas:android-back',{cancelable:true}));
   },0));
   await returnFromDirty;
   const saved=await page.evaluate(()=>{
     const text=localStorage.getItem('notas-exclusivas-pro-v2:keep-tool-demo:entry:keep-demo-note')||'';
     return text.includes('Rascunho fictício guardado');
   });
   assert(saved,'Back must locally save note changes before leaving the editor');
   console.log('PASS: Android Back dismisses note options, preserves edits, returns home and permits native exit.');
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
