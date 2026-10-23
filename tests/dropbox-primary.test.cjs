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
test('datas equivalentes com formatos distintos não criam falso conflito na migração',async()=>{
  const cloud=new FakeDropbox();
  const id='same-instant';
  const remote=basic(id,'<p>Conteúdo e objetos iguais</p>','2026-10-22T10:37:10.98+00:00');
  const local={...remote,updatedAt:'2026-10-22T10:37:10.980Z'};
  const a=device(cloud,[remote]);
  await a.engine.enable();
  const revBefore=JSON.parse(cloud.files.get(INDEX).body).entries[id].rev;
  const b=device(cloud,[local]);
  const result=await b.engine.enable();
  assert.equal(result.conflicts.length,0);
  assert.equal(result.pushed,0,'Nenhuma escrita remota quando a nota é equivalente');
  assert.equal(b.engine.enabled(),true);
  const revAfter=JSON.parse(cloud.files.get(INDEX).body).entries[id].rev;
  assert.equal(revAfter,revBefore);
});
test('conteúdo realmente diferente continua bloqueado mesmo com timestamp equivalente',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('distinct','Conteúdo remoto','2026-10-22T10:37:10.98+00:00')]);
  await a.engine.enable();
  const b=device(cloud,[basic('distinct','Conteúdo local','2026-10-22T10:37:10.980Z')]);
  const result=await b.engine.reconcile();
  assert.equal(result.conflicts.length,1);
  assert.equal(b.items[0].content,'Conteúdo local');
  assert.equal(db.deserialize(cloud.files.get(JSON.parse(cloud.files.get(INDEX).body).entries.distinct.path).body,owner).content,'Conteúdo remoto');
});
test('checkpoints históricos com datas não normalizadas são migrados sem upload',async()=>{
  const crypto=require('node:crypto');
  const cloud=new FakeDropbox();
  const original=basic('legacy','Texto idêntico','2026-10-22T10:37:10.98+00:00');
  const a=device(cloud,[original]);
  await a.engine.enable();
  const stored=JSON.parse(cloud.files.get(INDEX).body).entries.legacy;
  const b=device(cloud,[{...original,updatedAt:'2026-10-22T10:37:10.980Z'}]);
  const loc=b.items[0];
  const legacyArray=[loc.id,loc.title,loc.titleHtml,loc.content,loc.updatedAt,loc.deletedAt];
  const oldHash=crypto.createHash('sha256').update(JSON.stringify(legacyArray)).digest('hex');
  b.local.setItem(b.engine.mapKey,JSON.stringify({legacy:{
    path:stored.path,rev:stored.rev,hash:oldHash,syncedAt:loc.updatedAt
  }}));
  const result=await b.engine.reconcile();
  assert.equal(result.pushed,0);
  assert.equal(result.conflicts.length,0);
  const checkpoint=b.engine.readMap().legacy;
  assert.notEqual(checkpoint.hash,oldHash,'Checkpoint usa o novo hash normalizado');
  assert.equal(checkpoint.rev,stored.rev);
});
test('datas de eliminação em formatos equivalentes também são comparadas semanticamente',async()=>{
  const cloud=new FakeDropbox();
  const remote={...basic('deleted','Texto que permanece na lápide','2026-10-22T10:37:10.98+00:00'),
    deletedAt:'2026-10-22T10:37:10.98+00:00'};
  const a=device(cloud,[remote]);await a.engine.enable();
  const local={...remote,updatedAt:'2026-10-22T10:37:10.980Z',
    deletedAt:'2026-10-22T10:37:10.980Z'};
  const b=device(cloud,[local]);
  const r=await b.engine.reconcile();
  assert.equal(r.conflicts.length,0);
  assert.equal(r.pushed,0);
});
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
  const beforeIndex=cloud.files.get(INDEX).body;
  const compared=await b.engine.inspectConflict('f');
  assert.equal(compared.local.content,'Versão POCO');
  assert.equal(compared.remote.content,'Versão PC');
  assert.equal(cloud.files.get(INDEX).body,beforeIndex,'Comparação não altera o índice');
  const resolution=await b.engine.resolveWithLocal('f');
  assert.ok(resolution.backupId);
  assert.equal(b.items.find(n=>n.id===resolution.backupId).content,'Versão PC');
  await b.engine.reconcile();
  const index=JSON.parse(cloud.files.get(INDEX).body);
  assert.equal(db.deserialize(cloud.files.get(index.entries.f.path).body,owner).content,'Versão POCO');
  assert.equal(db.deserialize(cloud.files.get(index.entries[resolution.backupId].path).body,owner).content,'Versão PC');
});
test('a versão antiga já está indexada como backup antes da substituição da nota principal',async()=>{
  const cloud=new FakeDropbox(),a=device(cloud,[basic('s','Inicial')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].content='Versão remota';a.items[0].updatedAt='2026-10-23T11:00:00.000Z';
  b.items[0].content='Versão local';b.items[0].updatedAt='2026-10-23T11:01:00.000Z';
  await a.engine.reconcile();
  const originalUpload=cloud.upload.bind(cloud);
  let backupWasIndexedAtOverwrite=false;
  cloud.upload=async(path,body,revision)=>{
    if(revision && path.endsWith('.keepnote.json')) {
      const entries=JSON.parse(cloud.files.get(INDEX).body).entries;
      backupWasIndexedAtOverwrite=Object.entries(entries).some(([key,entry])=>
        key!=='s' && db.deserialize(cloud.files.get(entry.path).body,owner).content==='Versão remota');
    }
    return originalUpload(path,body,revision);
  };
  await b.engine.resolveWithLocal('s');
  assert.equal(backupWasIndexedAtOverwrite,true);
});
test('falha ao guardar a cópia remota não permite substituir o conteúdo original',async()=>{
  const cloud=new FakeDropbox(),a=device(cloud,[basic('r','Original')]);
  await a.engine.enable();
  const b=device(cloud);
  await b.engine.reconcile();
  a.items[0].content='Remoto';a.items[0].updatedAt='2026-10-23T11:00:00.000Z';
  b.items[0].content='Local';b.items[0].updatedAt='2026-10-23T11:01:00.000Z';
  await a.engine.reconcile();
  const previousIndex=JSON.parse(cloud.files.get(INDEX).body);
  const originalUpload=cloud.upload.bind(cloud);
  cloud.upload=async(path,body,revision)=>{
    if(path.endsWith('.keepnote.json') && !revision)
      throw cloud.error(503,'Falha simulada ao preservar a cópia');
    return originalUpload(path,body,revision);
  };
  await assert.rejects(()=>b.engine.resolveWithLocal('r'),/Falha simulada/);
  const entry=previousIndex.entries.r;
  assert.equal(db.deserialize(cloud.files.get(entry.path).body,owner).content,'Remoto');
  assert.equal(cloud.files.get(entry.path).rev,entry.rev);
  assert.equal(b.items.find(n=>n.id==='r').content,'Local');
  assert.ok(b.items.some(n=>n.id!=='r' && n.content==='Remoto'),'Cópia local de recuperação mantida');
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
