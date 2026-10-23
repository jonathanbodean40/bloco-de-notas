'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const db = require('../dropbox-storage.js');
const owner = 'synthetic-owner';
const note = {id:'synthetic-id',title:'Nota de teste',titleHtml:'',content:'<p>Conteúdo inventado</p>',updatedAt:'2026-10-23T10:00:00Z',deletedAt:null};
const raw = db.serialize(note,owner,'https://example.invalid/bloco/');
const file = {'.tag':'file',name:db.noteFilename(note),path_display:db.notePath('/Notas Pro',note),rev:'synthetic-rev-1'};
function widget() {
  return {
    children:[], listeners:{}, value:'', textContent:'', disabled:false,
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);},
    async click(){for(const fn of [...(this.listeners.click || [])]) await fn();},
    append(item){this.children.push(item);},
    replaceChildren(){this.children=[];},
    showModal(){this.open=true;},close(){this.open=false;}
  };
}
function harness(entry=file,body=raw) {
  const elems = new Map(), store = new Map();
  const element = name => {
    if(!elems.has(name)) elems.set(name,widget());
    return elems.get(name);
  };
  const imported=[], opened=[];
  store.set('notas-pro:dropbox-app-key:v1','publickey1234');
  store.set('notas-pro:dropbox-folder:v1:'+owner,'/Notas Pro');
  globalThis.document={getElementById:element,createElement:()=>widget()};
  globalThis.localStorage={
    getItem(key){return store.get(key) ?? null;},
    setItem(key,value){store.set(key,String(value));},
    removeItem(key){store.delete(key);}
  };
  globalThis.NOTAS_PRIVATE={authorized:true};
  globalThis.addEventListener=()=>{};
  globalThis.NotasDropboxStorage=db;
  globalThis.NotasDropboxPrimary=require('../dropbox-primary.js');
  globalThis.NotasDropboxOAuth={DropboxOAuth:class {
    constructor({appKey}){this.appKey=appKey;}
    connected(){return true;}
    async getToken(){return 'synthetic-token';}
    async restorePersistent(){return false;}
    disconnect(){}
  }};
  globalThis.fetch=async url=>{
    if(url.endsWith('/files/list_folder')) return {ok:true,json:async()=>({entries:[entry],has_more:false})};
    if(url.endsWith('/files/download'))return {ok:true,text:async()=>body};
    throw Error('A rede de teste foi bloqueada: '+url);
  };
  const ui=require('../dropbox-ui.js');
  ui.create({
    owner,getNote:id=>imported.find(n=>n.id===id),
    getNotes:()=>imported,
    applyRemote:()=>false,prepareActivation:async()=>true,requestSync:()=>{},
    importNote:remote=>{
      if(imported.find(n=>n.id===remote.id))throw Error('Nota existente');
      imported.push(remote);
    },
    getActiveId:()=>null,getCurrentOwner:()=>owner,
    ensureSaved:()=>true,openNote:id=>opened.push(id),
    currentUrl:'https://example.invalid/bloco/'
  });
  return {element,store,imported,opened};
}
test('uma nota só no Dropbox é importada sem substituição e abre no segundo clique',async()=>{
  const h=harness();
  await h.element('dropbox-browse').click();
  await new Promise(resolve => setImmediate(resolve));
  const b=h.element('dropbox-folders').children.find(x=>x.textContent.startsWith('Importar nota:'));
  assert.ok(b);
  await b.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.imported.length,1);
  assert.deepEqual(h.imported[0],note);
  const mapping=JSON.parse(h.store.get('notas-pro:dropbox-mappings:v1:'+owner));
  assert.equal(mapping[note.id].rev,file.rev);
  assert.equal(b.disabled,false);
  await b.click();
  assert.deepEqual(h.opened,[note.id]);
});
test('rejeita conteúdo Dropbox com identificador não correspondente ao nome',async()=>{
  const mismatched=db.serialize({...note,id:'outro-id'},owner,'https://example.invalid/bloco/');
  const h=harness(file,mismatched);
  await h.element('dropbox-browse').click();
  await new Promise(resolve => setImmediate(resolve));
  const b=h.element('dropbox-folders').children.find(x=>x.textContent.startsWith('Importar nota:'));
  await b.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.imported.length,0);
  assert.equal(b.disabled,false);
  assert.match(h.element('dropbox-status').textContent,/incompatível/);
});
