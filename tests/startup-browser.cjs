'use strict';

// Isolated browser integration test. Never reads a browser profile, production
// configuration, cookies, credentials or real notes. All auth/data are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const outputDir = path.resolve(root, '..', 'verification');
const baselineRef = process.env.BASELINE_REF || '144b247';
const assetDelayMs = Number(process.env.APP_SCRIPT_DELAY_MS || 180);
const publicFiles = ['index.html', 'style.css', 'dropbox-feedback.css', 'private-access.js', 'app.js', 'spell-worker.js', 'icon.svg', 'manifest.webmanifest'];
const additionalPublic = ['dropbox-storage.js', 'dropbox-token-vault.js', 'dropbox-oauth.js', 'dropbox-primary.js', 'dropbox-ui.js'];
const sources = {current: {}, baseline: {}};
for (const name of publicFiles) {
  sources.current[name] = fs.readFileSync(path.join(root, name));
  // This stylesheet was introduced after the historical baseline and is
  // only referenced by the current version of the application.
  if(name!=='dropbox-feedback.css')
    sources.baseline[name] = execFileSync('git', ['show', `${baselineRef}:${name}`], {cwd: root, maxBuffer: 12 * 1024 * 1024});
}
for(const name of additionalPublic) sources.current[name] = fs.readFileSync(path.join(root, name));
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const notes = [
  {id: 'synthetic-note-a', title: 'nota alpha', titleHtml: '', content: '<p>conteúdo sintético alpha</p>', updatedAt: '2026-10-01T12:03:00.000Z', deletedAt: null},
  {id: 'synthetic-note-b', title: 'nota beta', titleHtml: '', content: '<p>conteúdo sintético beta</p>', updatedAt: '2026-10-01T12:02:00.000Z', deletedAt: null},
  {id: 'synthetic-note-c', title: 'nota gamma', titleHtml: '', content: '<p>conteúdo sintético gamma</p>', updatedAt: '2026-10-01T12:01:00.000Z', deletedAt: null}
];
const storageKey = 'notas-exclusivas-pro-v2:synthetic-owner';
const allowed = {allowed: true, reason: 'authorized', active_devices: 3, max_devices: 3};
const denied = reason => ({allowed: false, reason, active_devices: 3, max_devices: 3});

const mockVendor = `(() => {
  const m = window.__startupTest;
  let sessionValue = null, sessionReleased = false, sessionPending = [], rpcReleased = false, rpcValue, rpcPending = [];
  const emit = (type, data = {}) => m.events.push({type, at: performance.now(), ...data});
  const claims = btoa(JSON.stringify({session_id:'synthetic-session', exp:Math.floor(Date.now()/1000)+3600})).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const syntheticSession = {user:{id:'synthetic-owner',email:'synthetic@example.invalid'},access_token:'synthetic.'+claims+'.synthetic'};
  m.releaseSession = mode => {
    sessionValue = mode === 'valid' ? syntheticSession : null;
    sessionReleased = true;
    emit('session-release', {mode});
    const result = mode === 'error' ? {data:{session:null},error:{message:'Synthetic session failure'}} : {data:{session:sessionValue},error:null};
    sessionPending.splice(0).forEach(resolve => resolve(result));
  };
  m.releaseRpc = result => {
    rpcReleased = true; rpcValue = result;
    emit('rpc-release', {allowed:result.data?.allowed===true, error:!!result.error});
    rpcPending.splice(0).forEach(resolve => resolve(result));
  };
  const client = {
    auth:{
      getSession(){emit('getSession-start');return (sessionReleased ? Promise.resolve({data:{session:sessionValue},error:null}) : new Promise(resolve=>sessionPending.push(resolve))).then(value=>{emit('getSession-end');return value;});},
      onAuthStateChange(callback){m.authCallback=callback;return {data:{subscription:{unsubscribe(){}}}};},
      signInWithPassword(){throw new Error('No real or interactive login allowed by this synthetic test');},
      signOut(){sessionValue=null;return Promise.resolve({error:null});}
    },
    rpc(name){emit('rpc-start',{name});if(name!=='personal_app_access')throw new Error('Unexpected RPC '+name);return (rpcReleased?Promise.resolve(rpcValue):new Promise(resolve=>rpcPending.push(resolve))).then(value=>{emit('rpc-end',{allowed:value.data?.allowed===true,error:!!value.error});return value;});},
    from(table){
      emit('notes-api',{table});
      if(table!=='notes')throw new Error('Unexpected table '+table);
      const result={data:${JSON.stringify(notes.map(n => ({id:n.id,title:n.title,title_html:n.titleHtml,content:n.content,updated_at:n.updatedAt,deleted_at:n.deletedAt})))},error:null};
      const query={select(){return query;},eq(){return query;},order(){return query;},then(resolve,reject){return Promise.resolve(result).then(resolve,reject);},upsert(rows){emit('notes-upsert',{count:rows.length});return Promise.resolve({data:null,error:null});}};
      return query;
    }
  };
  window.supabase={createClient(){emit('mock-client-created');return client;}};
})();`;

function installInstrumentation({seedNotes, key}) {
  const m = window.__startupTest = {events: [], states: [], noteReads: [], blockedExternal: [], readyAt: null, authorizedAt: null};
  // Seed only an isolated, temporary context's local origin before observing reads.
  localStorage.setItem(key, JSON.stringify(seedNotes));
  localStorage.setItem(`${key}:primary`, seedNotes[0].id);
  localStorage.setItem('notas-exclusivas-pro-v2:spelling-language', 'off');
  const originalGet = Storage.prototype.getItem;
  Storage.prototype.getItem = function(name) {
    if (String(name).startsWith('notas-exclusivas-pro-v2')) m.noteReads.push({key: String(name), at: performance.now()});
    return originalGet.call(this, name);
  };
  const visible = el => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && !!el.getClientRects().length;
  };
  function state() {
    const shell = document.querySelector('#private-app');
    return {at: performance.now(), gateVisible: visible(document.querySelector('#private-access')), formVisible: visible(document.querySelector('#private-login-form')), shellVisible: visible(shell), shellHidden: shell?.hidden ?? null, shellInert: shell?.inert ?? null, authorized: !!window.NOTAS_PRIVATE?.authorized};
  }
  m.state = state;
  let previous = '';
  function capture() {
    const current = state(), serialized = JSON.stringify({...current, at:0});
    if (serialized !== previous) {m.states.push(current);previous = serialized;}
  }
  new MutationObserver(capture).observe(document, {subtree:true, childList:true, attributes:true, attributeFilter:['hidden','class','inert','style']});
  function frame() {capture();requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
  addEventListener('DOMContentLoaded', capture);
  addEventListener('notas:private-ready', () => {m.readyAt=performance.now();m.events.push({type:'application-ready',at:m.readyAt});capture();});
  addEventListener('notas:private-authorized', () => {m.authorizedAt=performance.now();m.events.push({type:'shell-authorized',at:m.authorizedAt});capture();});
}

const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const serverRequests = [];
const browserHttpTransport = process.env.BROWSER_HTTP_TRANSPORT === 'direct' ? 'direct' : 'intercepted-static';
async function staticReply(requestUrl, transport) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const parts = url.pathname.split('/').filter(Boolean);
  const variant = parts.shift() || 'current';
  const version = variant.startsWith('baseline') ? 'baseline' : 'current';
  const name = parts.join('/') || 'index.html';
  const record = {variant, file:name, transport, at:Date.now()};
  serverRequests.push(record);
  let body;
  if (name === 'vendor/supabase-js-v2.js') body = Buffer.from(mockVendor);
  else if (name === 'config.js') body = Buffer.from("window.NOTAS_CONFIG={supabaseUrl:'https://synthetic.supabase.co',supabasePublishableKey:'sb_publishable_synthetic_test_only'};");
  else if (publicFiles.includes(name) || additionalPublic.includes(name)) body = sources[version][name];
  else return {status:404,body:Buffer.from('Test server serves public static assets only'),headers:{'Cache-Control':'no-store'}};
  if (name === 'app.js' && variant.endsWith('-delayed')) await new Promise(resolve => setTimeout(resolve, assetDelayMs));
  record.respondedAt = Date.now();
  return {status:200,body,headers:{'Cache-Control':'no-store','Content-Type':mime[path.extname(name)] || 'application/octet-stream'}};
}
const server = http.createServer(async (request, response) => {
  const reply=await staticReply(request.url,'local-http');
  response.writeHead(reply.status,reply.headers);
  response.end(reply.body);
});

let browser;
const evidence = {
  generatedAt: new Date().toISOString(), baselineRef,
  environment: {browser:'Chrome headless via existing Playwright', isolatedContextPerScenario:true, persistentProfile:false, serviceWorkers:'blocked', externalNetwork:'blocked', syntheticDataOnly:true,staticDelivery:browserHttpTransport},
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([version, files]) => [version,Object.fromEntries(Object.entries(files).map(([name,body])=>[name,sha256(body)]))])),
  conditions: {sessionHoldMs:220,rpcHoldMs:220,controlledAppResponseDelayMs:assetDelayMs},
  limitations: ['Synthetic session and Supabase RPC; no production login or real account tested.', 'Static local responses and synthetic waits measure browser ordering/overhead, not production network latency.', 'Service worker cache/update behavior is excluded from this integration test.', 'Default delivery uses Playwright route.fulfill because Chrome loopback HTTP was blocked (ERR_NETWORK_ACCESS_DENIED); no browser/network permission was changed. Set BROWSER_HTTP_TRANSPORT=direct where local HTTP is permitted.'],
  scenarios: [], checks: [], comparison: null
};
const check = (condition, description) => {assert.ok(condition, description);evidence.checks.push(description);};
const pause = (page, ms) => page.waitForTimeout(ms);
const state = page => page.evaluate(() => window.__startupTest.state());
const snapshot = page => page.evaluate(() => {
  const m = window.__startupTest;
  return {events:m.events,states:m.states,noteReads:m.noteReads,readyAt:m.readyAt,authorizedAt:m.authorizedAt,current:m.state(),resources:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('/app.js')).map(r=>({initiatorType:r.initiatorType,startTime:r.startTime,responseEnd:r.responseEnd,duration:r.duration,transferSize:r.transferSize}))};
});

async function openCase(name, variant='current') {
  const context = await browser.newContext({serviceWorkers:'block', viewport:{width:1280,height:900}});
  const externalRequests = [], errors = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin === origin) {
      if(browserHttpTransport === 'direct') return route.continue();
      return route.fulfill(await staticReply(route.request().url(),'playwright-static-interception'));
    }
    externalRequests.push({url:route.request().url(),resourceType:route.request().resourceType()});
    return route.abort('blockedbyclient');
  });
  await context.addInitScript(installInstrumentation, {seedNotes:notes,key:storageKey});
  const page = await context.newPage();
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`${origin}/${variant}/`, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => typeof window.__startupTest?.releaseSession === 'function');
  return {name,variant,context,page,externalRequests,errors};
}

async function finishCase(testCase, extra={}) {
  const detail = await snapshot(testCase.page);
  const result = {name:testCase.name,variant:testCase.variant,...detail,externalRequests:testCase.externalRequests,pageErrors:testCase.errors,...extra};
  evidence.scenarios.push(result);
  check(testCase.errors.length === 0, `${testCase.name}: real app/guard have no page errors`);
  check(testCase.externalRequests.length === 0, `${testCase.name}: no external requests`);
  await testCase.context.close();
  return result;
}

async function restored(name, variant, verifyFeatures=false) {
  const testCase = await openCase(name, variant), {page} = testCase;
  await pause(page,220);
  const pendingSession=await snapshot(page);
  check(pendingSession.current.shellHidden && pendingSession.current.shellInert && !pendingSession.current.shellVisible, `${name}: pending session keeps editor hidden/inert`);
  check(pendingSession.noteReads.length === 0, `${name}: no note reads before restored session`);
  check(!pendingSession.current.formVisible, `${name}: no form before restored session`);
  if (variant.startsWith('current')) check(!pendingSession.current.gateVisible, `${name}: access card hidden while restoring session`);
  await page.evaluate(()=>window.__startupTest.releaseSession('valid'));
  await page.waitForFunction(()=>window.__startupTest.events.some(e=>e.type==='rpc-start'));
  await pause(page,220);
  const pendingRpc=await snapshot(page);
  check(pendingRpc.current.shellHidden && pendingRpc.current.shellInert && !pendingRpc.current.shellVisible, `${name}: pending RPC keeps editor hidden/inert`);
  check(pendingRpc.noteReads.length === 0, `${name}: no note reads before server approval`);
  check(await page.locator('script[src="app.js"]').count() === 0, `${name}: preloading does not execute the app before approval`);
  if (variant.startsWith('current')) {
    check(!pendingRpc.current.gateVisible && !pendingRpc.current.formVisible, `${name}: no login/access card during valid restore`);
    check(pendingRpc.resources.some(r=>r.initiatorType==='link'&&r.responseEnd>0), `${name}: app.js preload downloaded before RPC release`);
  }
  await page.evaluate(data=>window.__startupTest.releaseRpc({data,error:null}), allowed);
  await page.waitForFunction(()=>window.NOTAS_PRIVATE?.authorized && !document.querySelector('#private-app').hidden && !document.querySelector('#private-app').inert);
  await page.waitForFunction(()=>document.querySelectorAll('.sidebar-note-item').length===3);
  const ready=await snapshot(page);
  const rpcRelease=ready.events.find(e=>e.type==='rpc-release').at;
  check(ready.readyAt >= rpcRelease, `${name}: real app initializes only after server approval`);
  check(ready.noteReads.every(read=>read.at>=rpcRelease), `${name}: every note read follows approval`);
  check(!ready.current.gateVisible && !ready.current.formVisible && ready.current.shellVisible, `${name}: authorized app shown with no login screen`);
  if (variant.startsWith('current')) check(ready.states.every(s=>!s.gateVisible && !s.formVisible), `${name}: no observed access-card/login flash on valid startup`);
  const storedBefore=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
  check(JSON.stringify(storedBefore)===JSON.stringify(notes), `${name}: startup preserves synthetic note records byte-for-byte`);
  const motion=await page.evaluate(()=>['#sidebar','#private-access','#private-app'].map(selector=>{
    const element=document.querySelector(selector),style=getComputedStyle(element);
    return {selector,animationName:style.animationName,animationDuration:style.animationDuration,transitionDuration:style.transitionDuration,rect:{width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}};
  }));
  check(motion.every(s=>s.animationName==='none' && s.animationDuration==='0s' && s.transitionDuration==='0s'), `${name}: startup surfaces have no CSS animation/transition`);
  let features;
  if(verifyFeatures==='primary') features=await verifyPrimaryMode(page);
  else if(verifyFeatures==='manual') features=await verifyManualDropboxFolder(page);
  else if(verifyFeatures) features=await verifyNoteFeatures(page);
  const getStart=ready.events.find(e=>e.type==='getSession-start').at;
  const getEnd=ready.events.find(e=>e.type==='getSession-end').at;
  const rpcStart=ready.events.find(e=>e.type==='rpc-start').at;
  const rpcEnd=ready.events.find(e=>e.type==='rpc-end').at;
  return finishCase(testCase,{pendingSession,pendingRpc,motion,features,timingsMs:{getSession:getEnd-getStart,rpc:rpcEnd-rpcStart,rpcReleaseToReady:ready.readyAt-rpcRelease,rpcReleaseToAuthorized:ready.authorizedAt-rpcRelease,navigationToReady:ready.readyAt}});
}

async function verifyNoteFeatures(page) {
  const orderBefore=await page.locator('.sidebar-note-item').evaluateAll(items=>items.map(item=>item.dataset.noteId));
  const first=await page.locator('.sidebar-note-item').nth(0).boundingBox();
  const last=await page.locator('.sidebar-note-item').nth(2).boundingBox();
  assert.ok(first&&last,'Synthetic note boxes exist');
  const start={x:first.x+first.width/2,y:first.y+first.height/2};
  await page.mouse.move(start.x,start.y);
  await page.mouse.down({button:'right'});
  await page.mouse.move(start.x,start.y+12,{steps:2});
  await page.mouse.move(last.x+last.width/2,last.y+last.height-4,{steps:8});
  await page.mouse.up({button:'right'});
  const orderAfter=await page.locator('.sidebar-note-item').evaluateAll(items=>items.map(item=>item.dataset.noteId));
  const savedOrder=await page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}:home-order`)),storageKey);
  check(orderAfter.join(',')===[orderBefore[1],orderBefore[2],orderBefore[0]].join(','),'features: right-button drag reorders synthetic notes');
  check(JSON.stringify(orderAfter)===JSON.stringify(savedOrder),'features: drag order persists locally');
  const item=page.locator('[data-note-id="synthetic-note-a"]');
  await item.locator('.sidebar-rename-btn').click();
  await item.locator('.sidebar-title-input').fill('título com palavras minúsculas');
  await item.locator('.sidebar-title-save').click();
  await page.waitForFunction(()=>document.querySelector('[data-note-id="synthetic-note-a"] strong')?.textContent==='título com palavras minúsculas');
  const renamed=await page.evaluate(key=>JSON.parse(localStorage.getItem(`${key}:entry:synthetic-note-a`)),storageKey);
  check(renamed.title==='título com palavras minúsculas','features: title rename on home screen preserves chosen capitalization');
  check(renamed.content===notes[0].content,'features: renaming preserves note content');
  const allStored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
  check(allStored[1].content===notes[1].content&&allStored[2].content===notes[2].content,'features: drag/rename preserves other note contents');
  await page.locator('#close-sidebar-btn').click();
  const editor=page.locator('.note-editor').first();
  await editor.waitFor({state:'visible'});
  await editor.fill('');
  await editor.pressSequentially('texto simples com palavras pequenas');
  const typed=await editor.innerText();
  check(typed==='Texto simples com palavras pequenas','features: real keyboard input capitalizes first sentence letter without capitalizing each word');
  await page.locator('[data-window="dropbox"]').first().click();
  check(await page.locator('#dropbox-dialog').evaluate(el=>el.open),'features: botão Dropbox abre caixa de diálogo sem ligação à nuvem');
  check((await page.locator('#dropbox-selected-note').innerText()).includes('Nota:'),'features: ligação Dropbox identifica nota ativa');
  await page.locator('#dropbox-close').click();
  check(!(await page.locator('#dropbox-dialog').evaluate(el=>el.open)),'features: diálogo Dropbox fecha sem alterar notas');
  await page.evaluate(() => {
    document.querySelector('#dropbox-key').value = 'synthetickey';
    sessionStorage.setItem('notas-pro-dropbox-pkce-v1:synthetic-owner:synthetickey:tokens', JSON.stringify({access_token:'synthetic-only',expires_at:Date.now()+3600000}));
    const original = window.fetch;
    window.fetch = (url, options) => {
      if (String(url).endsWith('/files/list_folder')) {
        return Promise.resolve(new Response(JSON.stringify({entries:[{'.tag':'file',name:'Alpha--synthetic-note-a.keepnote.json'}],has_more:false}),{status:200}));
      }
      return original(url, options);
    };
    window.open = url => {window.__syntheticDropboxOpened=url;return {closed:false,focus(){}};};
  });
  await page.locator('#dropbox-btn').click();
  await page.locator('#dropbox-browse').click();
  await page.getByText('Abrir nota: Alpha').click();
  const opened=await page.evaluate(()=>window.__syntheticDropboxOpened);
  check(new URL(opened).searchParams.get('note')==='synthetic-note-a','features: clicar nota na pasta Dropbox abre nota local com ID estável');
  return {orderBefore,orderAfter,savedOrder,renamedTitle:renamed.title,renamedContentUnchanged:true,typed,unsavedSyntheticEditingOnly:true};
}

async function verifyPrimaryMode(page) {
  await page.evaluate(() => {
    document.querySelector('#dropbox-key').value='synthetickey';
    document.querySelector('#dropbox-folder').value='/Bloco de Notas Pro/Notas';
    sessionStorage.setItem('notas-pro-dropbox-pkce-v1:synthetic-owner:synthetickey:tokens',
      JSON.stringify({access_token:'synthetic-only',expires_at:Date.now()+3600000}));
    const folders=new Set(['']),files=new Map();
    let sequence=0;
    window.__dropboxSynthetic={folders,files,changeRemote(id,content,when) {
      const path=JSON.parse(files.get('/Bloco de Notas Pro/.keep-notes-index.json').body).entries[id].path;
      const target=files.get(path),payload=JSON.parse(target.body);
      payload.note.content=content;payload.note.updatedAt=when;
      target.body=JSON.stringify(payload);target.rev='r'+(++sequence);
      const manifest=files.get('/Bloco de Notas Pro/.keep-notes-index.json');
      const index=JSON.parse(manifest.body);
      index.entries[id].rev=target.rev;
      index.entries[id].updatedAt=when;
      manifest.body=JSON.stringify(index);manifest.rev='r'+(++sequence);
    }};
    const original=window.fetch;
    window.fetch=async (url,options={})=>{
      if(!String(url).includes('dropboxapi.com'))return original(url,options);
      const endpoint=new URL(String(url)).pathname,missing=()=>new Response(
        JSON.stringify({error_summary:'path/not_found/'}),{status:409});
      const clash=()=>new Response(JSON.stringify({error_summary:'path/conflict/'}),{status:409});
      const ok=value=>new Response(JSON.stringify(value),{status:200});
      const data=options.body&&typeof options.body==='string'?JSON.parse(options.body):{};
      if(endpoint.endsWith('/files/get_metadata')) {
        const item=files.get(data.path);
        if(item)return ok({'.tag':'file',rev:item.rev,path_display:data.path});
        if(folders.has(data.path))return ok({'.tag':'folder',path_display:data.path});
        return missing();
      }
      if(endpoint.endsWith('/files/create_folder_v2')) {
        const path=data.path,parent=path.slice(0,path.lastIndexOf('/'));
        if(folders.has(path)||!folders.has(parent))return clash();
        folders.add(path);return ok({metadata:{'.tag':'folder',path_display:path}});
      }
      if(endpoint.endsWith('/files/list_folder'))return ok({entries:[],has_more:false});
      const args=JSON.parse(options.headers?.['Dropbox-API-Arg']||'{}');
      if(endpoint.endsWith('/files/download')) {
        const item=files.get(args.path);
        return item?new Response(item.body,{status:200}):missing();
      }
      if(endpoint.endsWith('/files/upload')) {
        const path=args.path,parent=path.slice(0,path.lastIndexOf('/')),old=files.get(path);
        const wanted=args.mode?.['.tag']==='update'?args.mode.update:null;
        if(!folders.has(parent)||(!wanted&&old)||(wanted&&old?.rev!==wanted))return clash();
        const body=new TextDecoder().decode(options.body);
        const rev='r'+(++sequence);files.set(path,{body,rev});
        return ok({rev,path_display:path});
      }
      throw Error('Endpoint de Dropbox inesperado: '+endpoint);
    };
  });
  await page.locator('#dropbox-btn').click();
  await page.locator('#dropbox-browse').click();
  await page.waitForFunction(()=>document.querySelector('#dropbox-status').textContent.startsWith('Pasta:'));
  // Reproduce the POCO report: activation was silently blocked by a conflict,
  // with the old error message outside the user's visible mobile viewport.
  await page.setViewportSize({width:393,height:852});
  await page.evaluate(()=>{
    const proto=window.NotasDropboxPrimary.Primary.prototype;
    window.__originalPreviewDifferences=proto.previewDifferences;
    proto.previewDifferences=async()=>{
      return {
        conflicts:[{id:'synthetic-note-a',message:'Duas versões diferentes'}],
        missingLocal:0,missingRemote:0,pendingChanges:0
      };
    };
  });
  await page.locator('#dropbox-inspect-conflicts').click();
  await page.waitForFunction(()=>document.querySelector('#dropbox-activation-feedback').dataset.state==='warning');
  check(await page.locator('#dropbox-activation-feedback').isVisible(),
    'dropbox-primary: read-only conflict status is visible in mobile layout');
  check(await page.evaluate(()=>window.__dropboxSynthetic.files.size===0),
    'dropbox-primary: read-only verification does not write any Dropbox file');
  await page.locator('#dropbox-enable-primary').click();
  await page.waitForFunction(()=>document.querySelector('#dropbox-activation-feedback').textContent.includes('Ativação bloqueada'));
  const activationWarning=await page.locator('#dropbox-activation-feedback').evaluate(el=>{
    const rect=el.getBoundingClientRect();
    return {visible:rect.top>=0&&rect.bottom<=window.innerHeight+4,
      warning:el.dataset.state==='warning',text:el.textContent};
  });
  check(activationWarning.warning&&activationWarning.visible,
    'dropbox-primary: failed activation gives visible warning beside button on 393px mobile');
  check(await page.evaluate(()=>window.__dropboxSynthetic.files.size===0),
    'dropbox-primary: blocked activation never migrates or deletes synthetic notes');
  check(await page.locator('#dropbox-enable-primary').isEnabled(),
    'dropbox-primary: activation button is re-enabled after a block');
  await page.evaluate(()=>{
    const proto=window.NotasDropboxPrimary.Primary.prototype;
    proto.previewDifferences=window.__originalPreviewDifferences;
    delete window.__originalPreviewDifferences;
  });
  await page.setViewportSize({width:1280,height:800});
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#dropbox-enable-primary').click();
  await page.waitForFunction(()=>localStorage.getItem('notas-pro:dropbox-primary:v1:synthetic-owner')==='1',{timeout:15000});
  const result=await page.evaluate(()=>{
    const d=window.__dropboxSynthetic,files=[...d.files.keys()];
    const index=JSON.parse(d.files.get('/Bloco de Notas Pro/.keep-notes-index.json').body);
    const saved=JSON.parse(localStorage.getItem('notas-exclusivas-pro-v2:synthetic-owner'));
    return {fileCount:files.length,indexed:Object.keys(index.entries).length,local:saved.length};
  });
  check(result.indexed===3,'dropbox-primary: all synthetic notes indexed before activation');
  check(result.fileCount===4,'dropbox-primary: one file per note plus index');
  check(result.local===3,'dropbox-primary: existing notes kept in local cache');
  await page.evaluate(()=>window.__dropboxSynthetic.changeRemote(
    'synthetic-note-b','<p>Atualização segura noutro dispositivo</p>','2026-10-24T12:00:00.000Z'));
  await page.locator('#dropbox-sync-all').click();
  await page.waitForFunction(()=>{
    const data=JSON.parse(localStorage.getItem('notas-exclusivas-pro-v2:synthetic-owner'));
    return data.some(n=>n.id==='synthetic-note-b'&&n.content.includes('Atualização segura'));
  },{timeout:10000});
  check(true,'dropbox-primary: remote revision pulled into local storage without page reload');
  const tokenVault=await page.evaluate(async()=>{
    const vault=window.NotasDropboxTokenVault;
    const original='refresh-token-100-percent-sintetico';
    await vault.remember('synthetic-owner','synthetickey',original);
    const recovered=await vault.restore('synthetic-owner','synthetickey');
    await vault.forget('synthetic-owner','synthetickey');
    const removed=await vault.restore('synthetic-owner','synthetickey');
    return {restored:recovered===original,removed:removed===null};
  });
  check(tokenVault.restored&&tokenVault.removed,'dropbox-primary: refresh token vault encrypts, restores and revokes in isolated browser');
  await page.setViewportSize({width:393,height:852});
  const mobile=await page.locator('#dropbox-dialog').evaluate(el=>{
    const rect=el.getBoundingClientRect(),css=getComputedStyle(el);
    return {width:rect.width,height:rect.height,overflowY:css.overflowY};
  });
  check(mobile.width<=393&&mobile.height<=852&&mobile.overflowY==='auto',
    'dropbox-primary: settings dialog remains scrollable on narrow mobile viewport');
  return {...result,tokenVault,mobile};
}

async function verifyManualDropboxFolder(page) {
  await page.locator('#close-sidebar-btn').click();
  await page.locator('.note-editor').first().waitFor({state:'visible'});
  await page.evaluate(() => {
    document.querySelector('#dropbox-key').value='synthetickey';
    document.querySelector('#dropbox-folder').value='/Notas Pro';
    sessionStorage.setItem('notas-pro-dropbox-pkce-v1:synthetic-owner:synthetickey:tokens',
      JSON.stringify({access_token:'synthetic-only',expires_at:Date.now()+3600000}));
    const folders=new Set(['']),files=new Map(),requests=[];
    let rev=0;
    window.__manualDropbox={folders,files,requests};
    const previous=window.fetch;
    window.fetch=async(url,options={})=>{
      if(!String(url).includes('dropboxapi.com'))return previous(url,options);
      const endpoint=new URL(String(url)).pathname;
      const args=endpoint.endsWith('/upload')
        ? JSON.parse(options.headers['Dropbox-API-Arg'])
        : JSON.parse(options.body||'{}');
      requests.push({endpoint,path:args.path,mode:args.mode});
      const respond=(data,status=200)=>new Response(JSON.stringify(data),{status});
      const missing=()=>respond({error_summary:'path/not_found/...'},409);
      if(endpoint.endsWith('/get_metadata')){
        if(folders.has(args.path))return respond({'.tag':'folder',path_display:args.path});
        if(files.has(args.path))return respond({'.tag':'file',rev:files.get(args.path).rev});
        return missing();
      }
      if(endpoint.endsWith('/create_folder_v2')){
        const parent=args.path.slice(0,args.path.lastIndexOf('/'));
        if(!folders.has(parent))return missing();
        if(folders.has(args.path)||files.has(args.path))
          return respond({error_summary:'path/conflict/folder/...'},409);
        folders.add(args.path);
        return respond({metadata:{'.tag':'folder',path_display:args.path}});
      }
      if(endpoint.endsWith('/upload')){
        const parent=args.path.slice(0,args.path.lastIndexOf('/'));
        if(!folders.has(parent))return missing();
        const previousFile=files.get(args.path),requestedRev=args.mode?.update;
        if(previousFile && previousFile.rev!==requestedRev)
          return respond({error_summary:'path/conflict/file/...'},409);
        if(previousFile && !requestedRev)return respond({error_summary:'path/conflict/file/...'},409);
        const raw=new TextDecoder().decode(options.body);
        const next='synthetic-rev-'+(++rev);
        files.set(args.path,{raw,rev:next});
        return respond({rev:next,path_display:args.path});
      }
      throw Error('Endpoint não previsto no teste: '+endpoint);
    };
  });
  await page.locator('#dropbox-btn').click();
  check((await page.locator('#dropbox-folder').inputValue())==='/Notas Pro',
    'manual: user selected missing folder retained');
  await page.locator('#dropbox-save').click();
  await page.waitForFunction(()=>document.querySelector('#dropbox-status').textContent.startsWith('Guardado no Dropbox:'),{timeout:10000});
  const first=await page.evaluate(()=>{
    const m=window.__manualDropbox;
    const remote=[...m.files.entries()];
    const hasFolder=m.folders.has('/Notas Pro');
    const stored=remote.map(([path,data])=>({path,payload:JSON.parse(data.raw)}));
    return {hasFolder,fileCount:remote.length,noteId:stored[0]?.payload?.note?.id,
      expectedPath:stored[0]?.path||'',creates:m.requests.filter(r=>r.endpoint.endsWith('/create_folder_v2')).length};
  });
  check(first.hasFolder,'manual: missing Dropbox folder created upon explicit save only');
  check(first.fileCount===1,'manual: exactly one synthetic note uploaded');
  check(first.creates===1,'manual: only the selected folder created');
  check(first.noteId==='synthetic-note-a','manual: note ID preserved');
  const source=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
  check(source.length===notes.length,'manual: existing local note count unchanged');
  await page.locator('#dropbox-save').click();
  await page.waitForFunction(()=>window.__manualDropbox.requests.filter(r=>r.endpoint.endsWith('/upload')).length===2,{timeout:10000});
  const after=await page.evaluate(()=>{
    const m=window.__manualDropbox;
    return {fileCount:m.files.size,updates:m.requests.filter(r=>r.endpoint.endsWith('/upload')&&r.mode?.['.tag']==='update').length};
  });
  check(after.fileCount===1&&after.updates===1,'manual: second save updates by Dropbox revision without creating a duplicate');
  return {hasFolder:first.hasFolder,fileCount:after.fileCount,updates:after.updates};
}

async function blockedCase(name, sessionMode, rpcResult) {
  const testCase=await openCase(name),{page}=testCase;
  await page.evaluate(mode=>window.__startupTest.releaseSession(mode),sessionMode);
  if(rpcResult){
    await page.waitForFunction(()=>window.__startupTest.events.some(e=>e.type==='rpc-start'));
    await page.evaluate(result=>window.__startupTest.releaseRpc(result),rpcResult);
  }
  await page.waitForFunction(()=>!document.querySelector('#private-access').hidden);
  const detail=await snapshot(page);
  check(!detail.current.authorized && detail.current.shellHidden && detail.current.shellInert && !detail.current.shellVisible,`${name}: denied/error/missing session keeps editor locked`);
  check(detail.noteReads.length===0,`${name}: no note reads on denied/error/missing session`);
  check(await page.locator('script[src="app.js"]').count()===0,`${name}: application never executes when blocked`);
  check(detail.current.formVisible === (sessionMode==='none'),`${name}: login form shown only for a confirmed missing session`);
  check(!detail.events.some(e=>e.type==='notes-api'),`${name}: no notes API request while blocked`);
  return finishCase(testCase,{message:await page.locator('#private-access-message').innerText()});
}

let origin;
(async()=>{
  fs.mkdirSync(outputDir,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'chrome',headless:true});
  evidence.environment.browserVersion=browser.version();
  await restored('current-valid-session','current',true);
  await restored('current-dropbox-primary','current','primary');
  await restored('current-manual-missing-folder','current','manual');
  await blockedCase('no-session','none');
  await blockedCase('session-restore-error','error');
  await blockedCase('device-limit-denial','valid',{data:denied('device_limit'),error:null});
  await blockedCase('not-owner-denial','valid',{data:denied('not_owner'),error:null});
  await blockedCase('rpc-network-error','valid',{data:null,error:{message:'Synthetic network error'}});
  await blockedCase('invalid-device-count','valid',{data:{...allowed,active_devices:4},error:null});
  const baseline=await restored('baseline-controlled-asset-latency','baseline-delayed');
  const current=await restored('current-controlled-asset-latency','current-delayed');
  evidence.comparison={baseline:baselineRef,controlledScriptResponseDelayMs:assetDelayMs,baselineRpcReleaseToReadyMs:baseline.timingsMs.rpcReleaseToReady,currentRpcReleaseToReadyMs:current.timingsMs.rpcReleaseToReady,deltaMs:baseline.timingsMs.rpcReleaseToReady-current.timingsMs.rpcReleaseToReady,baselineAccessCardObservedBeforeApproval:baseline.states.some(s=>s.at<baseline.events.find(e=>e.type==='rpc-release').at&&s.gateVisible),currentAccessCardObservedBeforeApproval:current.states.some(s=>s.at<current.events.find(e=>e.type==='rpc-release').at&&s.gateVisible),interpretation:'Controlled local comparison demonstrates app download moved before approval and removes access-card flash. This is not a measurement of production or real-account startup speed.'};
  check(evidence.comparison.baselineAccessCardObservedBeforeApproval,'comparison: baseline exposes access card before approval');
  check(!evidence.comparison.currentAccessCardObservedBeforeApproval,'comparison: current hides access card until access decision');
  check(evidence.comparison.deltaMs>assetDelayMs*.5,'comparison: preload overlaps controlled app download with session/RPC restoration');
  evidence.pass=true;
})().catch(error=>{
  evidence.pass=false;evidence.failure={message:error.message,stack:error.stack};process.exitCode=1;
}).finally(async()=>{
  if(browser)await browser.close();
  await new Promise(resolve=>server.close(resolve));
  evidence.serverRequests=serverRequests;
  fs.writeFileSync(path.join(outputDir,'startup-browser-evidence.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({pass:evidence.pass,scenarios:evidence.scenarios.length,checks:evidence.checks.length,comparison:evidence.comparison,failure:evidence.failure?.message,evidence:path.join(outputDir,'startup-browser-evidence.json')},null,2));
});
