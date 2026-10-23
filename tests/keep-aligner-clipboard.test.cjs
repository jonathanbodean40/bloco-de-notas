'use strict';
// Native Clipboard API in a disposable Chrome context; no real notes or account.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {start}=require('./support/keep-aligner-preview.cjs');
(async()=>{
  const server=await start(4398),browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const context=await browser.newContext({permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'});
    await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4398'?route.continue():route.abort());
    const page=await context.newPage();
    await page.goto('http://127.0.0.1:4398/?tool=keep');
    await page.locator('#ka-reference').fill('#TESTE-CLIPBOARD-NATIVO');
    const checks=[];
    for(const mode of ['guide','presentation']) {
      await page.locator(`#ka-copy-${mode}`).click();
      await page.locator('#ka-copy-status[data-state="success"]').waitFor();
      const copied=await page.evaluate(()=>navigator.clipboard.readText());
      assert.equal(copied.replace(/\r\n/g,'\n'),await page.locator('#ka-output').inputValue());
      assert(copied.includes(mode==='guide'?'Tarefa: SOMENTE GUIA':'Tarefa: APRESENTAÇÃO COMPLETA'));
      checks.push({mode,copied:true,length:copied.length});
    }
    const out=path.resolve(__dirname,'../../outputs/keep-aligner-tool/CLIPBOARD-NATIVO.json');
    fs.writeFileSync(out,JSON.stringify({passed:true,checks,syntheticOnly:true,physicalPhoneTested:false,published:false},null,2));
    console.log('PASS Clipboard API nativa: somente guia e apresentação, textos exatos.');
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
