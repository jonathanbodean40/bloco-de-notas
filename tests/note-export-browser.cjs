'use strict';
// Synthetic browser test: no profile, Dropbox account, application server or real notes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const filename=path.resolve(__dirname,'../note-export.js');
test('exportação Markdown e HTML preserva hiperligações Onyx e bloqueia scripts',async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({path:filename});
  const results=await page.evaluate(()=>{
   const id='synthetic-case-1234';
   const base='https://example.invalid/bloco-de-notas/';
   const link='https://www.hirschdynamics.com/onyxwebview/Hirsch.html?mlink=abc.iiwgl&p=TOKEN';
   const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
   const wrap=document.createElement('div');
   wrap.setAttribute('data-notas-pro','3');
   wrap.setAttribute('data-layout',JSON.stringify({kind:'onyx',onyxRows:[{
     html:'<p>Planeamento: <a href="'+link.replace(/&/g,'&amp;')+'">Abrir Onyx</a> e referência</p><script>globalThis.evil=true</script>',
     images:[png]
   }]}));
   const body=document.createElement('div');body.setAttribute('data-note-body','');
   body.textContent='Informações do caso';wrap.append(body);
   const note={id,title:'Plano Onyx Clínico',content:wrap.outerHTML,updatedAt:'2026-10-26T10:00:00Z',deletedAt:null};
   const e=window.NotasReadableExport;
   const md=e.make(note,'md',base,'synthetic-owner');
   const html=e.make(note,'html',base,'synthetic-owner');
   const documentHTML=new DOMParser().parseFromString(html.data,'text/html');
   const unsafeNote={id,title:'<img src=x onerror=alert(1)>',content:
     '<div data-notas-pro="3"><div data-note-body><p>Seguro <img src=x onerror="alert(1)">'+
     '<a href="javascript:alert(1)" onclick="alert(1)">Proibido</a>'+
     '<a href="https://example.invalid/docs?m=1&amp;n=2">Permitido</a></p>'+
     '<script>alert(1)</script></div></div>',updatedAt:note.updatedAt,deletedAt:null};
   const safe=e.make(unsafeNote,'html',base,'synthetic-owner');
   return {
     nameMD:md.name,nameHTML:html.name,
     mdText:md.data,
     imagePresent:html.data.includes(png),
     linkPresent:documentHTML.querySelector('main a')?.href===link,
     originalEditLink:documentHTML.querySelector('header a')?.href.includes('note='+id),
     htmlScriptCount:documentHTML.querySelectorAll('script,iframe').length,
     renderedTitle:documentHTML.querySelector('h1')?.textContent,
     escapedTitle:safe.data.includes('&lt;img src=x onerror=alert(1)&gt;'),
     noExecutable:safe.data.includes('onclick=')||safe.data.includes('<script>')||safe.data.includes('javascript:'),
     permittedLink:safe.data.includes('https://example.invalid/docs?m=1&amp;n=2'),
     mdWithOnyx:md.data.includes('['+'Abrir Onyx'+']') && md.data.includes('Hirsch.html'),
     validFolderExportName:md.name.endsWith('--synthetic-case-1234.md')
   };
  });
  assert.equal(results.validFolderExportName,true);
  assert.ok(results.nameHTML.endsWith('.html'));
  assert.equal(results.linkPresent,true);
  assert.equal(results.originalEditLink,true);
  assert.equal(results.htmlScriptCount,0);
  assert.equal(results.imagePresent,true);
  assert.equal(results.mdWithOnyx,true);
  assert.equal(results.renderedTitle,'Plano Onyx Clínico');
  assert.equal(results.escapedTitle,true);
  assert.equal(results.noExecutable,false);
  assert.equal(results.permittedLink,true);
 }finally{await browser.close();}
});
