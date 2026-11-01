'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const {start}=require('./support/keep-aligner-preview.cjs');
(async()=>{
  const server=await start(0);
  let browser;
  try{
    browser=await chromium.launch({channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
    const base='http://127.0.0.1:'+server.address().port;
    const bootstrap=fs.readFileSync(path.join(__dirname,'support/keep-aligner-preview-bootstrap.js'),'utf8');
    await context.route('**/*',route=>{
      const uri=new URL(route.request().url());
      if(uri.origin!==base)return route.abort();
      if(uri.pathname==='/private-access.js'){
        const mock="window.__cloud={from:()=>({select:()=>({eq:()=>({order:async()=>({data:[],error:null})})}),upsert:async()=>({error:null})})};";
        return route.fulfill({contentType:'text/javascript',body:mock+bootstrap.replace('client: null','client: window.__cloud')});
      }
      return route.continue();
    });
    const page=await context.newPage();
    await page.goto(base+'/?note=keep-demo-note&scope=keep-tool-demo');
    await page.locator('#app-footer').waitFor({state:'visible'});
    await page.locator('.window-bar [data-window="close"]').waitFor({state:'visible'});
    await page.evaluate(()=>{
      const root=document.documentElement;
      root.classList.add('native-android');
      root.style.setProperty('--notes-system-top','34px');
      root.style.setProperty('--notes-system-bottom','28px');
    });
    const m=await page.evaluate(()=>{
      const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};};
      return {viewport:innerHeight,footer:rect('#app-footer'),account:rect('#account-btn'),keep:rect('#keep-aligner-tool-btn'),close:rect('.window-bar [data-window="close"]'),header:rect('#app-header'),workspace:rect('#workspace'),sidebar:rect('.sidebar')};
    });
    const navTop=m.viewport-28;
    if(Math.abs(m.footer.bottom-navTop)>1)throw Error('Footer not directly above Android nav bar '+JSON.stringify(m));
    if(navTop-m.keep.bottom>9||navTop-m.account.bottom>15)throw Error('Too much empty space below footer controls '+JSON.stringify(m));
    if(m.keep.bottom>navTop||m.account.bottom>navTop)throw Error('Footer overlaps system navigation '+JSON.stringify(m));
    if(m.close.top<34+6||m.close.bottom>m.header.bottom+10)throw Error('Close button overlaps Android status/battery '+JSON.stringify(m));
    if(Math.abs(m.workspace.bottom-m.footer.top)>1)throw Error('Workspace overlaps footer '+JSON.stringify(m));
    if(m.sidebar.bottom>m.footer.top+1)throw Error('Sidebar overlaps footer '+JSON.stringify(m));
    console.log('PASS: Android 393x852 simulated status=34px, nav=28px; footer bottom '+m.footer.bottom+'; Keep button gap '+(navTop-m.keep.bottom)+'px; Close button top '+m.close.top+'px');
  } finally {await browser?.close();await new Promise(done=>server.close(done));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
