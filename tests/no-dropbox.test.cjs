'use strict';
// Disposable profile and synthetic notes only; no real account or external API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {start} = require('./support/keep-aligner-preview.cjs');
(async () => {
  const server = await start(0);
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome', headless:true});
    const context = await browser.newContext({viewport:{width:390,height:844}});
    const base = `http://127.0.0.1:${server.address().port}`;
    const external = [], errors = [];
    const bootstrap = fs.readFileSync(path.join(__dirname,'support/keep-aligner-preview-bootstrap.js'),'utf8');
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) { external.push(url.hostname); return route.abort(); }
      if (url.pathname === '/private-access.js') {
        const mock = `window.__writes=[];window.__reads=0;
          window.__cloud={from:()=>({select:()=>({eq:()=>({order:async()=>{window.__reads++;return {data:[],error:null}}})}),upsert:async rows=>{window.__writes.push(rows);return {error:null}}})};`;
        return route.fulfill({contentType:'text/javascript',body:mock+bootstrap.replace('client: null','client: window.__cloud')});
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      // Legacy mode settings must have no effect on the normal storage path.
      localStorage.setItem('notas-pro:dropbox-primary:v1:keep-tool-demo', '1');
    });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const url = base+'/?note=keep-demo-note&scope=keep-tool-demo';
    await page.goto(url);
    const editor = page.locator('.note-editor');
    await editor.waitFor();
    assert.equal(await page.locator('[id*="dropbox"],script[src*="dropbox"]').count(),0);
    await editor.fill('Nota sintética preservada sem integração externa.');
    await page.locator('[data-window="save"]').click();
    await page.locator('#sync-icon-btn').click();
    await page.waitForFunction(() => window.__writes.some(rows=>rows.some(n=>n.content.includes('Nota sintética preservada'))));
    assert(await page.evaluate(()=>window.__reads>0));
    await page.reload();
    await editor.waitFor();
    assert((await editor.innerText()).includes('Nota sintética preservada'));
    assert.equal(await page.locator('body').innerText().then(s=>/conflito.*Dropbox/i.test(s)),false);
    assert.deepEqual(external,[]);
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile save/reload preserves notes; normal account sync reads/writes despite legacy settings; no Dropbox UI, scripts or external requests.');
  } finally { await browser?.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
