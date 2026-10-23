'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const db = require('../dropbox-storage.js');
const owner='synthetic-user';
const base='https://example.invalid/notas/';
const note={id:'synthetic-id',title:'Ação',titleHtml:'',content:'<p>Sintético</p>',updatedAt:'2026-10-23T10:00:00Z',deletedAt:null};
const reply=(body,ok=true,status=200)=>({ok,status,json:async()=>body,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
test('formato reversível e segregação de contas',()=>{
  const data=db.serialize(note,owner,base);
  assert.deepEqual(db.deserialize(data,owner),note);
  assert.throws(()=>db.deserialize(data,'outro-utilizador'));
  assert.equal(JSON.parse(data).openUrl,base+'?note=synthetic-id&scope=synthetic-user');
});
test('importação remota valida proprietário, nome, ID e exclusão sem alterar a nota', () => {
  const raw = db.serialize(note, owner, base);
  const original = JSON.parse(raw);
  assert.deepEqual(db.importableNote(raw, owner, db.noteFilename(note)), note);
  assert.throws(() => db.importableNote(raw, 'conta-diferente', db.noteFilename(note)));
  assert.throws(() => db.importableNote(raw, owner, 'Outra--outro-id.keepnote.json'));
  assert.throws(() => db.importableNote(raw, owner, 'ficheiro.json'));
  original.note.deletedAt = '2026-10-23T11:00:00Z';
  assert.throws(() => db.importableNote(JSON.stringify(original), owner, db.noteFilename(note)));
});
test('pastas não aceitam percursos perigosos',()=>{
  assert.equal(db.folderPath('Keep/Planos'),'/Keep/Planos');
  assert.equal(db.folderPath('/'),'');
  for(const path of ['/A/../B','/A//B','/A/.','/A/'])assert.throws(()=>db.folderPath(path));
  assert.equal(db.noteFilename(note),'Acao--synthetic-id.keepnote.json');
});
test('alterações remotas são comparadas antes da escrita',()=>{
  assert.equal(db.revisionDecision(note,{...note}),'unchanged');
  const changed={...note,title:'novo',updatedAt:'2026-10-24T10:00:00Z'};
  assert.equal(db.revisionDecision(changed,note),'review');
  assert.equal(db.revisionDecision(changed,note,'revision1'),'upload-if-revision-matches');
  assert.equal(db.revisionDecision(note,changed,'revision1'),'download-if-local-unchanged');
});
test('carregamento inicial e atualização com revisão',async()=>{
  const calls=[];
  const client=new db.Client({getToken:async()=>'synthetic',fetch:async(url,opts)=>{calls.push({url,opts});return reply({rev:'next'});}});
  const data=db.serialize(note,owner,base);
  await client.upload('/Keep/nota.keepnote.json',data);
  await client.upload('/Keep/nota.keepnote.json',data,'rev123');
  const first=JSON.parse(calls[0].opts.headers['Dropbox-API-Arg']);
  const second=JSON.parse(calls[1].opts.headers['Dropbox-API-Arg']);
  assert.equal(first.mode['.tag'],'add');
  assert.equal(first.autorename,false);
  assert.deepEqual(second.mode,{'.tag':'update',update:'rev123'});
  assert.equal(new TextDecoder().decode(calls[0].opts.body),data);
});
test('conflito remoto bloqueia atualização',async()=>{
  const client=new db.Client({getToken:async()=>'synthetic',fetch:async()=>reply('conflito',false,409)});
  await assert.rejects(()=>client.upload('/Keep/nota.keepnote.json','data','older'),err=>err.status===409);
});
test('paginação e leitura autenticada',async()=>{
  const urls=[];
  const client=new db.Client({getToken:async()=>'synthetic',fetch:async(url)=>{
    urls.push(url);
    if(url.endsWith('/list_folder'))return reply({entries:[{name:'A'}],has_more:true,cursor:'xyz'});
    if(url.endsWith('/continue'))return reply({entries:[{name:'B'}],has_more:false});
    return reply('conteudo de exemplo');
  }});
  assert.deepEqual((await client.listFolder('')).map(x=>x.name),['A','B']);
  assert.equal(await client.download('/A/nota.json'),'conteudo de exemplo');
});
