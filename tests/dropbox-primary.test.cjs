'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../dropbox-storage.js');
const {Primary,INDEX,DEFAULT_FOLDER,ROOT}=require('../dropbox-primary.js');
const owner='test-account';
const clone=value=>JSON.parse(JSON.stringify(value));
const basic=(id,content,updatedAt='2026-10-23T10:00:00.000Z')=>({
  id,title:'Nota '+id,titleHtml:'',content,updatedAt,deletedAt:null
});
function store() {
  const values=new Map();
  return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),
    removeItem:k=>values.delete(k),snapshot:()=>Object.fromEntries(values)};
}
class FakeDropbox {
  constructor(){this.files=new Map();this.folders=new Set(['']);this.seq=0;this.fail=false;}
  error(status,details){return Object.assign(new Error(details),{status,details});}
  check(){if(this.fail)throw this.error(0,'Sem ligação ao Dropbox');}
  async createFolder(path){
    this.check();
    if(this.folders.has(path)||this.files.has(path))throw this.error(409,'path/conflict/folder');
    const parent=path.slice(0,path.lastIndexOf('/'));
    if(!this.folders.has(parent))throw this.error(409,'path/not_found');
    this.folders.add(path);return {};
  }
  async metadata(path){
    this.check();
    const file=this.files.get(path);
    if(file)return {'.tag':'file',rev:file.rev,path_display:path};
    if(this.folders.has(path))return {'.tag':'folder',path_display:path};
    throw this.error(409,'path/not_found');
  }
  async upload(path,body,rev){
    this.check();
    const old=this.files.get(path);
    if((rev&&!old)||(!rev&&old)||(rev&&old.rev!==rev))
      throw this.error(409,'path/conflict');
    const parent=path.slice(0,path.lastIndexOf('/'));
    if(!this.folders.has(parent))throw this.error(409,'path/not_found');
    const next='rev-'+(++this.seq);
    this.files.set(path,{body,rev:next});
    return {rev:next,path_display:path};
  }
  async download(path){
    this.check();
    const file=this.files.get(path);
    if(!file)throw this.error(409,'path/not_found');
    return file.body;
  }
}
function device(cloud,seed=[]) {
  const items=clone(seed),local=store();
  const engine=new Primary({
    owner,client:()=>cloud,getNotes:()=>clone(items),
    importNote:note=>{
      if(items.some(n=>n.id===note.id))return false;
      items.push(clone(note));return true;
    },
    applyRemote:(remote,expected)=>{
      const idx=items.findIndex(n=>n.id===expected.id);
      if(idx<0||items[idx].updatedAt!==expected.updatedAt ||
         Date.parse(remote.updatedAt)<=Date.parse(expected.updatedAt))return false;
      items[idx]=clone(remote);return true;
    },
    storage:local
  });
  return {items,local,engine};
}
test('migra duas notas para uma pasta central e recupera-as num segundo dispositivo',async()=>{
  const cloud=new FakeDropbox();
  const one=device(cloud,[basic('first','<p>A</p>'),basic('second','<p>B</p>')]);
  const result=await one.engine.enable();
  assert.equal(result.pushed,2);
  assert.equal(one.engine.enabled(),true);
  assert.ok(cloud.folders.has(ROOT));
  assert.ok(cloud.folders.has(DEFAULT_FOLDER));
  const index=JSON.parse(cloud.files.get(INDEX).body);
  assert.equal(Object.keys(index.entries).length,2);
  const two=device(cloud);
  const pulled=await two.engine.reconcile();
  assert.equal(pulled.pulled,2);
  assert.deepEqual(two.items,one.items);
  assert.equal(two.engine.enabled(),false);
});
test('revisões atualizam segundo dispositivo, sem apagar notas locais',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('x','texto anterior')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].content='texto atualizado';
  a.items[0].updatedAt='2026-10-23T11:00:00.000Z';
  assert.equal((await a.engine.reconcile()).pushed,1);
  assert.equal((await b.engine.reconcile()).pulled,1);
  assert.equal(b.items[0].content,'texto atualizado');
  assert.equal(b.items[0].updatedAt,a.items[0].updatedAt);
});
test('edição simultânea gera conflito, sem substituição nem perda',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('c','inicial')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].content='mudança no PC';
  a.items[0].updatedAt='2026-10-23T11:00:00.000Z';
  b.items[0].content='mudança no POCO';
  b.items[0].updatedAt='2026-10-23T11:01:00.000Z';
  await a.engine.reconcile();
  const result=await b.engine.reconcile();
  assert.equal(result.conflicts.length,1);
  assert.equal(b.items[0].content,'mudança no POCO');
  const entry=JSON.parse(cloud.files.get(INDEX).body).entries.c;
  assert.equal(db.deserialize(cloud.files.get(entry.path).body,owner).content,'mudança no PC');
});
test('resolução explícita conserva as duas versões concorrentes sem apagar dados',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('f','Original')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].content='Versão PC';a.items[0].updatedAt='2026-10-23T11:00:00.000Z';
  b.items[0].content='Versão POCO';b.items[0].updatedAt='2026-10-23T11:01:00.000Z';
  await a.engine.reconcile();
  assert.equal((await b.engine.reconcile()).conflicts.length,1);
  b.engine.setEnabled(true);
  const resolution=await b.engine.resolveWithLocal('f');
  assert.ok(resolution.backupId);
  assert.equal(b.items.find(n=>n.id===resolution.backupId).content,'Versão PC');
  await b.engine.reconcile();
  const index=JSON.parse(cloud.files.get(INDEX).body);
  assert.equal(db.deserialize(cloud.files.get(index.entries.f.path).body,owner).content,'Versão POCO');
  assert.equal(db.deserialize(cloud.files.get(index.entries[resolution.backupId].path).body,owner).content,'Versão PC');
});
test('falha de Internet não elimina alterações locais nem liga modo primário',async()=>{
  const cloud=new FakeDropbox(),a=device(cloud,[basic('d','offline')]);
  cloud.fail=true;
  await assert.rejects(()=>a.engine.enable());
  assert.equal(a.engine.enabled(),false);
  assert.equal(a.items[0].content,'offline');
});
test('nota eliminada mantém lápide recuperável na nuvem',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('z','conteúdo anterior')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].deletedAt='2026-10-23T12:00:00.000Z';
  a.items[0].updatedAt=a.items[0].deletedAt;
  await a.engine.reconcile();
  await b.engine.reconcile();
  assert.equal(b.items[0].deletedAt,a.items[0].deletedAt);
  const entry=JSON.parse(cloud.files.get(INDEX).body).entries.z;
  assert.equal(db.deserialize(cloud.files.get(entry.path).body,owner).content,'conteúdo anterior');
});
test('dados remotos divergentes impedem ativar Dropbox como principal',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('one','PC')]);
  await a.engine.enable();
  const b=device(cloud,[basic('one','POCO','2026-10-23T12:00:00.000Z')]);
  await assert.rejects(()=>b.engine.enable(),err=>err.code==='DROPBOX_CONFLICT');
  assert.equal(b.engine.enabled(),false);
  assert.equal(b.items[0].content,'POCO');
});
