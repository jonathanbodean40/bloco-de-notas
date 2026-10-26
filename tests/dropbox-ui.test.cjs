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
    children:[], listeners:{}, dataset:{}, value:'', textContent:'', disabled:false,
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);},
    async click(){for(const fn of [...(this.listeners.click || [])]) await fn();},
    append(...items){this.children.push(...items);},
    replaceChildren(){this.children=[];},
    remove(){this.removed=true;},
    showModal(){this.open=true;},close(){this.open=false;}
  };
}
function harness(entry=file,body=raw,primaryOverride=null,options={}) {
  const elems = new Map(), store = new Map();
  const element = name => {
    if(!elems.has(name)) elems.set(name,widget());
    return elems.get(name);
  };
  const imported=[], opened=[];
  globalThis.confirm=options.confirm||(()=>true);
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
  globalThis.NotasReadableExport=require('../note-export.js');
  globalThis.NotasDropboxPrimary=primaryOverride||require('../dropbox-primary.js');
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
  const instance=ui.create({
    owner,getNote:id=>imported.find(n=>n.id===id),
    getNotes:()=>imported,
    applyRemote:()=>false,prepareActivation:options.prepareActivation|| (async()=>true),requestSync:options.requestSync||(()=>{}),
    importNote:remote=>{
      if(imported.find(n=>n.id===remote.id))throw Error('Nota existente');
      imported.push(remote);
    },
    getActiveId:()=>null,getCurrentOwner:()=>owner,
    ensureSaved:()=>true,openNote:id=>opened.push(id),
    currentUrl:'https://example.invalid/bloco/'
  });
  return {element,store,imported,opened,instance};
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

test('comparação de conflito mostra ambas as versões sem substituir notas',async()=>{
  const local={...note,title:'',content:'<p>Esta edição local</p>'};
  const resolves=[];
  const remote={...note,title:'',content:'<div><img src="invalid" onerror="steal()"><p>Versão no Dropbox</p></div>'};
  const stub={Primary:class {
    enabled(){return true;}
    async reconcile(){return {conflicts:[{id:note.id,message:'Alterações diferentes em dois dispositivos; requer revisão'}]};}
    async inspectConflict(id){assert.equal(id,note.id);return {local,remote};}
    async resolveWithRemote(id){resolves.push(id);return {noteId:id,backupId:'synthetic-backup-id'};}
  }};
  const h=harness(file,raw,stub);
  h.imported.push(local);
  await h.instance.syncPrimary();
  const rows=h.element('dropbox-conflicts').children;
  assert.equal(rows.length,2);
  assert.match(rows[0].textContent,/1 nota\(s\) com divergências/);
  const [label,inspect,preview,action]=rows[1].children;
  assert.match(label.textContent,/Sem título/);
  assert.match(label.textContent,/the|synthetic-id|etic-id/i);
  assert.equal(preview.hidden,true);
  await inspect.click();
  assert.equal(preview.hidden,false);
  assert.equal(preview.children.length,3);
  assert.match(preview.children[0].textContent,/Prévia textual resumida/);
  assert.match(preview.children[1].children[2].textContent,/Esta edição local/);
  assert.match(preview.children[2].children[2].textContent,/Versão no Dropbox/);
  assert.doesNotMatch(preview.children[2].children[2].textContent,/onerror/);
  assert.equal(action.textContent,'Preservar ambas as versões e usar esta edição');
  const preferDropbox=rows[1].children[4];
  assert.match(preferDropbox.textContent,/Manter versão Dropbox/);
  assert.equal(h.imported.length,1);
  await preferDropbox.click();
  assert.deepEqual(resolves,[note.id]);
  assert.match(h.element('dropbox-status').textContent,/preservada como nota/);
  assert.equal(rows[1].removed,true);
  assert.equal(h.imported[0].content,local.content);
});

const nextTurn = () => new Promise(resolve=>setImmediate(resolve));

test('verificação de conflitos não ativa Dropbox nem escreve notas',async()=>{
  const operations=[];
  const stub={Primary:class {
    enabled(){return false;}
    async previewDifferences(){operations.push('preview');return {
      conflicts:[{id:note.id,message:'Duas versões diferentes'}],
      missingLocal:0,missingRemote:0,pendingChanges:0
    };}
    async reconcile(){operations.push('WRITE_INCORRETO');throw Error('Não deve escrever');}
  }};
  const h=harness(file,raw,stub);
  h.imported.push({...note});
  await h.element('dropbox-inspect-conflicts').click();
  await nextTurn();
  assert.deepEqual(operations,['preview']);
  assert.equal(h.element('dropbox-conflicts').children.length,2);
  assert.match(h.element('dropbox-activation-feedback').textContent,/1 nota\(s\).*diferentes/);
  assert.equal(h.element('dropbox-activation-feedback').dataset.state,'warning');
  assert.equal(h.element('dropbox-enable-primary').disabled,false);
  assert.deepEqual(h.imported,[note]);
});

test('ativar com divergência apresenta erro junto ao botão sem pedir aprovação ou escrever',async()=>{
  const calls=[];
  const stub={Primary:class {
    enabled(){return false;}
    async previewDifferences(){calls.push('preview');return {
      conflicts:[{id:note.id,message:'Conflito de versões'}],
      missingRemote:0,missingLocal:0
    };}
    async reconcile(){calls.push('write');throw Error('Não permitido');}
    async enable(){calls.push('enable');throw Error('Não permitido');}
  }};
  const h=harness(file,raw,stub,{
    prepareActivation:async()=>{calls.push('supabase');return true;},
    confirm:()=>{calls.push('confirm');return true;}
  });
  h.imported.push({...note});
  await h.element('dropbox-enable-primary').click();
  await nextTurn();
  assert.deepEqual(calls,['preview']);
  assert.match(h.element('dropbox-primary-status').textContent,/Ativação bloqueada/);
  assert.match(h.element('dropbox-activation-feedback').textContent,/Comparar as duas versões/);
  assert.equal(h.element('dropbox-activation-feedback').dataset.state,'warning');
  assert.equal(h.element('dropbox-enable-primary').disabled,false);
});

test('falha na verificação Supabase é visível perto do botão e pode ser repetida',async()=>{
  const calls=[];
  const stub={Primary:class {
    enabled(){return false;}
    async previewDifferences(){calls.push('preview');return {
      conflicts:[],missingLocal:0,missingRemote:0
    };}
    async reconcile(){calls.push('write');throw Error('Não permitido');}
  }};
  const h=harness(file,raw,stub,{
    prepareActivation:async()=>{calls.push('supabase');throw Error('A sincronização anterior não foi confirmada');},
    confirm:()=>{calls.push('confirm');return true;}
  });
  await h.element('dropbox-enable-primary').click();
  await nextTurn();
  assert.deepEqual(calls,['preview','supabase']);
  assert.equal(h.element('dropbox-activation-feedback').dataset.state,'error');
  assert.match(h.element('dropbox-activation-feedback').textContent,/sincronização anterior não foi confirmada/);
  assert.equal(h.element('dropbox-enable-primary').disabled,false);
  assert.equal(h.element('dropbox-sync-all').disabled,true);
});

test('ativação sem conflitos mantém confirmação, preserva notas e mostra estado ativo',async()=>{
  const calls=[];
  let active=false;
  const stub={Primary:class {
    enabled(){return active;}
    async previewDifferences(){calls.push('preview');return {
      conflicts:[],missingLocal:1,missingRemote:1
    };}
    async reconcile(){calls.push('reconcile');return {conflicts:[],pushed:1,pulled:1};}
    async enable(){calls.push('enable');active=true;return {conflicts:[],pushed:0,pulled:0};}
  }};
  const h=harness(file,raw,stub,{
    prepareActivation:async()=>{calls.push('supabase');return true;},
    confirm:()=>{calls.push('confirm');return true;},
    requestSync:()=>calls.push('request-sync')
  });
  const existing={...note};
  h.imported.push(existing);
  await h.element('dropbox-enable-primary').click();
  await nextTurn();
  assert.deepEqual(calls.slice(0,5),['preview','supabase','confirm','reconcile','enable']);
  assert.ok(calls.slice(5).length>=1);
  assert.ok(calls.slice(5).every(item=>item==='request-sync'));
  assert.equal(h.element('dropbox-enable-primary').disabled,true);
  assert.equal(h.element('dropbox-sync-all').disabled,false);
  assert.equal(h.element('dropbox-activation-feedback').dataset.state,'success');
  assert.match(h.element('dropbox-activation-feedback').textContent,/principal ativado/);
  assert.deepEqual(h.imported,[existing]);
});

test('dois toques rápidos nunca iniciam duas verificações de ativação',async()=>{
  let checkCount=0;
  let finishCheck;
  const deferred=new Promise(resolve=>finishCheck=resolve);
  const stub={Primary:class {
    enabled(){return false;}
    async previewDifferences(){checkCount++;return deferred;}
    async reconcile(){throw Error('Não deve escrever');}
  }};
  const h=harness(file,raw,stub);
  await Promise.all([
    h.element('dropbox-enable-primary').click(),
    h.element('dropbox-enable-primary').click()
  ]);
  await nextTurn();
  assert.equal(checkCount,1);
  assert.equal(h.element('dropbox-enable-primary').disabled,true);
  finishCheck({conflicts:[{id:note.id,message:'Divergência'}],missingRemote:0,missingLocal:0});
  await nextTurn();
  assert.equal(h.element('dropbox-enable-primary').disabled,false);
});
