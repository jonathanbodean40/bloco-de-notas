'use strict';
// Only synthetic inputs, loopback server and disposable Chrome contexts.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {buildPrompt} = require('../keep-aligner-tool.js');
const {start} = require('./support/keep-aligner-preview.cjs');
const root = path.resolve(__dirname, '..'), out = path.resolve(root, '../outputs/keep-aligner-tool');
const results = [], errors = [], blocked = [];
const sample = {reference: '#TESTE100', planning: 'https://example.invalid/view?mlink=ficticio.iiwgl&p=FICTICIO', status: 'approved', kind: 'new', version: 'PLANO FICTÍCIO 2'};
let browser, server, currentPage, base;
async function check(name, fn) { await fn(); results.push(name); console.log('PASS '+name); }
async function setup(options = {}) {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block', ...options});
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blocked.push(url.origin); return route.abort();
  });
  await context.addInitScript(() => {
    window.__copies = [];
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async text => {
      if (window.__denyClipboard) throw new Error('Synthetic clipboard denial');
      window.__copies.push(text);
    }}});
    document.execCommand = command => {
      if (command !== 'copy' || window.__denyFallback) return false;
      const el = document.activeElement;
      window.__copies.push(el.value.slice(el.selectionStart, el.selectionEnd)); return true;
    };
  });
  const page = await context.newPage(); currentPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base+'/?note=keep-demo-note&scope=keep-tool-demo');
  await page.locator('.note-editor').waitFor();
  return {context, page};
}
async function open(page) { await page.getByRole('button', {name: 'KEEP ALIGNER', exact: true}).click(); await page.locator('#keep-aligner-dialog[open]').waitFor(); }
async function copied(page) { await page.locator('#ka-copy-status[data-state="success"]').waitFor(); return page.evaluate(() => window.__copies.at(-1)); }
async function run() {
  fs.mkdirSync(out, {recursive:true});
  await check('Pedido somente guia preserva escopo, referência, versão e aprovação específica', () => {
    const text = buildPrompt('guide', sample);
    assert(text.includes('Tarefa: SOMENTE GUIA')); assert(text.includes(sample.reference)); assert(text.includes(sample.planning));
    assert(text.includes(sample.version)); assert(text.includes('APROVADO PELO DOUTOR'));
    assert(text.includes('Não crie apresentação completa nem publique em My Keep'));
    assert(text.includes('MANUAL RAPIDO.md')); assert(text.includes('Não altere guias já entregues'));
  });
  await check('Apresentação pede pacote, revisão e autorização antes de escrita My Keep', () => {
    const text = buildPrompt('presentation', {...sample, status:'review', kind:'refinement'});
    for (const word of ['APRESENTAÇÃO COMPLETA','4K','contactos oclusais desligados','fontes CSV','+ IVA','EM REVISÃO','REFINAMENTO','Salvar Alterações','autorização específica']) assert(text.includes(word), word);
  });
  await check('Aprovação e tipo desconhecidos nunca são presumidos; campos opcionais funcionam', () => {
    const text = buildPrompt('guide', {reference:'  #TESTE200  ', status:'bogus', kind:'bogus', notes:'  Informação fornecida\r\nSegunda linha  '});
    assert(text.includes('Caso: #TESTE200\n')); assert(text.includes('NÃO CONFIRMADO'));
    assert(text.includes('Informação fornecida\nSegunda linha')); assert(!text.includes('undefined'));
  });
  await check('Recusa referência vazia, modo inválido, URLs inseguras e excesso de tamanho', () => {
    assert.throws(() => buildPrompt('guide', {})); assert.throws(() => buildPrompt('publish', sample));
    assert.throws(() => buildPrompt('guide', {...sample, planning:'javascript:alert(1)'}));
    assert.throws(() => buildPrompt('guide', {...sample, planning:'plano sem endereço'}));
    assert.throws(() => buildPrompt('guide', {...sample, notes:'x'.repeat(2001)}));
  });
  await check('Autenticação, configuração e estilos principais preservados face à versão publicada', () => {
    // The note editor is intentionally modified to restore export and reordering.
    // Authentication/configuration and approved main styling must not regress.
    for (const name of ['private-access.js','config.js','style.css']) {
      assert.equal(execFileSync('git',['diff','--exit-code','HEAD','--',name],{cwd:root,encoding:'utf8'}),'');
    }
    const tool = fs.readFileSync(path.join(root,'keep-aligner-tool.js'),'utf8');
    for (const forbidden of [/localStorage\./,/sessionStorage\./,/\bfetch\(/,/supabase/]) assert(!forbidden.test(tool));
  });
  server = await start(0);
  base = 'http://127.0.0.1:'+server.address().port;
  browser = await chromium.launch({channel:'chrome', headless:true});
  let {context, page} = await setup();
  const key = 'notas-exclusivas-pro-v2:keep-tool-demo';
  const notesBefore = await page.evaluate(key => localStorage.getItem(key),key);
  await open(page);
  await check('Painel acessível, foco inicial e referência obrigatória', async () => {
    assert.equal(await page.locator('#ka-reference').evaluate(el=>document.activeElement===el), true);
    await page.locator('#ka-copy-guide').click(); assert.equal(await page.evaluate(()=>window.__copies.length),0);
    assert.equal(await page.locator('#ka-reference').evaluate(el=>el.validity.valueMissing),true);
    assert.equal(await page.locator('#ka-status').inputValue(),'unknown');
  });
  await page.locator('#ka-reference').fill(sample.reference);
  await page.locator('#ka-planning').fill(sample.planning);
  await page.locator('#ka-status').selectOption('approved');
  await check('Botão somente guia copia texto exato e mantém as notas existentes', async () => {
    await page.locator('#ka-copy-guide').click();
    assert.equal(await copied(page),buildPrompt('guide',{...sample,version:'',kind:'unknown'}));
    assert.equal(await page.locator('#ka-output').getAttribute('readonly'),'');
    assert((await page.locator('#ka-copy-guide').innerText()).includes('✓ Copiado'));
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),notesBefore);
  });
  await check('Alterar dados invalida o pedido anterior; apresentação usa o novo caso', async () => {
    await page.locator('#ka-reference').fill('#TESTE200');
    assert.equal(await page.locator('#ka-result').isHidden(),true);
    await page.locator('#ka-copy-presentation').click();
    const text=await copied(page); assert(text.includes('#TESTE200')); assert(!text.includes('#TESTE100'));
    assert(text.includes('Tarefa: APRESENTAÇÃO COMPLETA'));
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),notesBefore);
  });
  await check('Não interpreta o conteúdo dos campos como HTML executável', async () => {
    await page.locator('#ka-reference').fill('#QA <img src=x onerror=alert(1)>');
    await page.locator('#ka-copy-guide').click();
    assert((await copied(page)).includes('<img src=x onerror=alert(1)>'));
    assert.equal(await page.locator('#keep-aligner-dialog img').count(),0);
  });
  await check('URL 3D inválida não copia nem substitui o último texto válido', async () => {
    const count=await page.evaluate(()=>window.__copies.length);
    await page.locator('#ka-planning').fill('não é um link'); await page.locator('#ka-copy-guide').click();
    assert.equal(await page.evaluate(()=>window.__copies.length),count);
    await page.locator('#ka-planning').fill('');
  });
  await check('Cópia alternativa funciona quando Clipboard API é bloqueada', async () => {
    await page.evaluate(()=>window.__denyClipboard=true);
    await page.locator('#ka-copy-guide').click(); assert((await copied(page)).includes('SOMENTE GUIA'));
  });
  await check('Falha total permite cópia manual, sem anunciar sucesso falso', async () => {
    await page.evaluate(()=>window.__denyFallback=true); await page.locator('#ka-copy-guide').click();
    await page.locator('#ka-copy-status[data-state="manual"]').waitFor();
    const selected=await page.locator('#ka-output').evaluate(el=>({start:el.selectionStart,end:el.selectionEnd,size:el.value.length}));
    assert.equal(selected.start,0); assert.equal(selected.end,selected.size);
  });
  await check('Escape fecha e devolve foco; reabrir mantém os campos da página', async () => {
    const reference=await page.locator('#ka-reference').inputValue();
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#keep-aligner-dialog').getAttribute('open'),null);
    assert.equal(await page.locator('#keep-aligner-tool-btn').evaluate(el=>el===document.activeElement),true);
    await open(page); assert.equal(await page.locator('#ka-reference').inputValue(),reference);
  });
  await check('Bloquear a sessão fecha o painel e apaga os campos privados', async () => {
    await page.evaluate(()=>{const shell=document.getElementById('private-app');shell.hidden=true;shell.inert=true;document.body.classList.add('private-locked');});
    await page.locator('#keep-aligner-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('#ka-reference').inputValue(),''); assert.equal(await page.locator('#ka-output').inputValue(),'');
    assert.equal(await page.locator('#keep-aligner-tool-btn').isVisible(),false);
  });
  await context.close();
  ({context,page}=await setup()); await open(page);
  await page.locator('#ka-reference').fill('#CASO FICTÍCIO');
  await page.screenshot({path:path.join(out,'PREVIA-PC.png')});
  await check('Sem sobreposição horizontal no PC e botões com área de toque adequada', async () => {
    const d=await page.locator('#keep-aligner-dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth}));assert(d.scroll<=d.client+1);
    for(const selector of ['#keep-aligner-close','#ka-copy-guide','#ka-copy-presentation','#keep-aligner-tool-btn']) assert((await page.locator(selector).boundingBox()).height>=44);
  });
  await context.close();
  for (const size of [{width:390,height:844},{width:320,height:640},{width:844,height:390}]) {
    ({context,page}=await setup({viewport:size,isMobile:true,hasTouch:true})); await open(page);
    await page.locator('#ka-reference').fill('#TESTE-MOVEL');
    await check(`Ecrã móvel ${size.width}×${size.height}: ambos os pedidos copiáveis sem corte horizontal`, async () => {
      for(const mode of ['guide','presentation']) { await page.locator(`#ka-copy-${mode}`).tap(); const text=await copied(page); assert(text.includes('#TESTE-MOVEL')); assert(text.includes(mode==='guide'?'SOMENTE GUIA':'APRESENTAÇÃO COMPLETA')); }
      const d=await page.locator('#keep-aligner-dialog').evaluate(el=>({scroll:el.scrollWidth,client:el.clientWidth})); assert(d.scroll<=d.client+1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.locator('#ka-reference').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)),16);
    });
    if(size.width===390) {
      await page.locator('#ka-reference').fill('#CASO FICTÍCIO');
      await page.locator('#keep-aligner-dialog').evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:path.join(out,'PREVIA-TELEMOVEL.png')});
    }
    await context.close();
  }
  const offline = await browser.newContext({viewport:{width:1000,height:850}});
  const op = await offline.newPage(); currentPage=op;
  await op.goto(base+'/?note=keep-demo-note&scope=keep-tool-demo'); await op.locator('.note-editor').waitFor();
  await check('Cache nova contém todos os recursos publicados sem guardar respostas privadas da conta', async () => {
    const worker=fs.readFileSync(path.join(root,'service-worker.js'),'utf8');
    const cacheVersion=worker.match(/const CACHE='([^']+)'/)?.[1];
    const manifest=worker.match(/const FILES=\[([^\]]+)\]/)?.[1]||'';
    const assetNames=[...manifest.matchAll(/'([^']+)'/g)].map(match=>match[1]);
    assert.ok(cacheVersion && assetNames.length>=12,'Manifesto de cache inválido');
    await op.evaluate(async()=>{
      await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
    });
    await op.waitForFunction(async({version,length})=>{
      if(!await caches.has(version))return false;
      const c=await caches.open(version);
      return(await c.keys()).length===length;
    },{version:cacheVersion,length:assetNames.length});
    const cached=await op.evaluate(async version=>{
      const c=await caches.open(version);
      return(await c.keys()).map(r=>new URL(r.url).pathname);
    },cacheVersion);
    const expected=assetNames.map(name=>new URL(name,base+'/').pathname);
    assert.deepEqual(cached.slice().sort(),expected.slice().sort(),'A cache corresponde exatamente ao manifesto publicado');
    for(const required of ['/keep-aligner-tool.js','/keep-aligner-tool.css','/dropbox-feedback.css','/index.html'])
      assert(cached.includes(required),'Recurso offline em falta: '+required);
    assert(!cached.some(url=>/\/(?:auth|rest|notes-api)(?:\/|$)/.test(url)),
      'A cache não deve guardar respostas de autenticação ou dados de conta');
    for(const name of ['keep-aligner-tool.js','keep-aligner-tool.css','dropbox-feedback.css','index.html']) {
      const bytes=await op.evaluate(async({name,version})=>{
        const cached=await caches.open(version);
        const response=await cached.match('/'+name);
        if(!response)throw new Error('Asset offline em falta: '+name);
        return Array.from(new Uint8Array(await response.arrayBuffer()));
      },{name,version:cacheVersion});
      assert.equal(crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'),
        crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'));
    }
  });
  await check('A ferramenta abre offline e preserva a nota sintética', async () => {
    await op.reload(); await op.evaluate(()=>navigator.serviceWorker.ready); await offline.setOffline(true); await op.reload();
    await op.locator('#keep-aligner-tool-btn').waitFor(); await open(op);
    assert.equal(await op.locator('#ka-reference').inputValue(),'');
    assert.equal(JSON.parse(await op.evaluate(key=>localStorage.getItem(key),key))[0].id,'keep-demo-note');
  });
  await offline.close();
  assert.deepEqual(errors,[]); assert.deepEqual(blocked,[]);
  await browser.close(); await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,'RESULTADOS.json'),JSON.stringify({passed:true,checks:results.length,results,errors,externalRequests:blocked,syntheticOnly:true,published:false,physicalPhoneTested:false,clipboard:'isolated stub and selection fallback',checkedAt:new Date().toISOString()},null,2));
  console.log('ALL PASSED: '+results.length);
}
run().catch(async error=>{
  console.error(error.stack);
  if(currentPage&&!currentPage.isClosed()) await currentPage.screenshot({path:path.join(out,'FALHA.png')}).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});if(server)server.close();
  fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'RESULTADOS.json'),JSON.stringify({passed:false,results,error:error.stack,errors,published:false},null,2));process.exitCode=1;
});
