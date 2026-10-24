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
function device(cloud,seed=[],sharedStorage=null) {
  const items=clone(seed),local=sharedStorage||store();
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
    adoptRemote:(remote,expected)=>{
      const idx=items.findIndex(n=>n.id===expected.id);
      if(idx<0||items[idx].updatedAt!==expected.updatedAt)return false;
      items[idx]=clone(remote);return true;
    },
    storage:local
  });
  return {items,local,engine};
}
test('duas janelas preservam checkpoints de notas diferentes mesmo com snapshots antigos',async()=>{
  const cloud=new FakeDropbox(),shared=store();
  const a=device(cloud,[basic('tab-a','Nota A')],shared);
  await a.engine.enable();
  const oldSnapshot=a.engine.readMap();
  const b=device(cloud,[basic('tab-a','Nota A'),basic('tab-b','Nota B')],shared);
  const first=await b.engine.reconcile();
  assert.equal(first.pushed,1);
  assert.ok(b.engine.readMap()['tab-b'],'A nota B tem checkpoint depois de ser enviada');
  a.engine.saveMap(oldSnapshot,'tab-a');
  const restored=b.engine.readMap();
  assert.ok(restored['tab-b'],'Uma atualização antiga da nota A não apaga o checkpoint de B');
  b.items.find(n=>n.id==='tab-b').title='Nota B renomeada';
  b.items.find(n=>n.id==='tab-b').updatedAt='2026-10-23T11:00:00.000Z';
  const second=await b.engine.reconcile();
  assert.equal(second.conflicts.length,0,'Não apresenta conflito falso');
  assert.equal(second.pushed,1,'O título alterado foi sincronizado automaticamente');
  const entry=JSON.parse(cloud.files.get(INDEX).body).entries['tab-b'];
  assert.equal(db.deserialize(cloud.files.get(entry.path).body,owner).title,'Nota B renomeada');
});
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

function noteHtml({body='<p>Texto original</p>',rect={x:14,y:14,w:400,h:600},popupRect={x:0,y:0,w:400,h:600},objects=[],shipments=[]}={}) {
  const layout={bg:'#ffffff',textWidth:100,objects,kind:'normal',onyxRows:[],shipments,folders:[],location:null,rect,popupRect};
  const escaped=JSON.stringify(layout).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  return '<div data-notas-pro="3" data-layout="'+escaped+'"><div data-note-body="">'+body+'</div></div>';
}
test('migração POCO evita conflitos causados apenas pelo tamanho das janelas',async()=>{
  const cloud=new FakeDropbox();
  const previous=basic('geometry',noteHtml({rect:{x:10,y:10,w:850,h:590},popupRect:{w:910,h:740}}),'2026-10-23T09:00:00Z');
  const mobile={...previous,content:noteHtml({rect:{x:0,y:0,w:340,h:620},popupRect:{w:390,h:844}}),updatedAt:'2026-10-24T00:56:00Z'};
  const msi=device(cloud,[previous]);await msi.engine.enable();
  const rev=JSON.parse(cloud.files.get(INDEX).body).entries.geometry.rev;
  const poco=device(cloud,[mobile]);
  const migrated=await poco.engine.enable();
  assert.equal(migrated.conflicts.length,0);
  assert.equal(migrated.pushed,0);
  assert.equal(poco.engine.enabled(),true);
  assert.equal(JSON.parse(cloud.files.get(INDEX).body).entries.geometry.rev,rev);
  assert.equal(poco.items[0].content,mobile.content,'Layout local preservado no POCO');
  const repeated=await poco.engine.reconcile();
  assert.equal(repeated.conflicts.length,0);
  assert.equal(repeated.pushed,0,'Não faz upload desnecessário após reiniciar');
});
test('mudança genuína de texto continua a gerar conflito mesmo com geometria diferente',async()=>{
  const cloud=new FakeDropbox();
  const a=device(cloud,[basic('different-text',noteHtml({body:'<p>Texto do MSI</p>'}))]);
  await a.engine.enable();
  const b=device(cloud,[basic('different-text',noteHtml({body:'<p>Texto novo do POCO</p>',rect:{w:300,h:630}}),'2026-10-24T01:00:00Z')]);
  const result=await b.engine.reconcile();
  assert.equal(result.conflicts.length,1);
  assert.equal(b.items[0].content.includes('Texto novo do POCO'),true);
  assert.equal(db.deserialize(cloud.files.get(JSON.parse(cloud.files.get(INDEX).body).entries['different-text'].path).body,owner).content.includes('Texto do MSI'),true);
});
test('mudança de objetos clínicos preservados no layout NÃO é ignorada',async()=>{
  const cloud=new FakeDropbox();
  const note=basic('objects',noteHtml({objects:[{type:'label',text:'Texto A'}]}));
  const a=device(cloud,[note]);await a.engine.enable();
  const altered={...note,content:noteHtml({objects:[{type:'label',text:'Texto B'}],rect:{x:1,y:2,w:350,h:700}})};
  const b=device(cloud,[altered]);
  assert.equal((await b.engine.reconcile()).conflicts.length,1);
});
test('duas lápides de exclusão idênticas não ressuscitam notas nem geram conflito',async()=>{
  const cloud=new FakeDropbox();
  const original={...basic('purged','<div data-notas-purged="1"></div>'),'deletedAt':'2026-09-22T09:51:40.342Z',
    updatedAt:'2026-10-09T18:07:55.248Z'};
  const a=device(cloud,[original]);await a.engine.enable();
  const poco=device(cloud,[{...original,deletedAt:'2026-09-21T09:51:40.342+00:00',
    updatedAt:'2026-10-24T00:45:00Z'}]);
  const check=await poco.engine.reconcile();
  assert.equal(check.conflicts.length,0);
  assert.equal(check.pushed,0);
  assert.ok(poco.items[0].deletedAt);
  assert.equal(JSON.parse(cloud.files.get(INDEX).body).entries.purged.deletedAt,original.deletedAt);
});
test('não confunde nota ativa e nota eliminada mesmo quando o conteúdo é igual',async()=>{
  const cloud=new FakeDropbox();
  const original=basic('live-or-deleted','<p>Dados</p>');
  const a=device(cloud,[original]);await a.engine.enable();
  const b=device(cloud,[{...original,deletedAt:'2026-10-23T11:00:00Z'}]);
  const r=await b.engine.reconcile();
  assert.equal(r.conflicts.length,1);
  assert.equal(b.items[0].deletedAt,'2026-10-23T11:00:00Z');
});
test('resolução mantém lápide remota como cópia eliminada, sem criar nota ativa vazia',async()=>{
  const cloud=new FakeDropbox();
  const remote={...basic('old-del','<div data-notas-purged="1"></div>'),'deletedAt':'2026-09-22T09:51:40.342Z'};
  const a=device(cloud,[remote]);await a.engine.enable();
  const local={...remote,content:'<p>Recuperado no POCO</p>',deletedAt:null,updatedAt:'2026-10-24T01:00:00Z'};
  const b=device(cloud,[local]);
  const before=(await b.engine.reconcile());
  assert.equal(before.conflicts.length,1);
  const resolution=await b.engine.resolveWithLocal('old-del');
  const safety=b.items.find(n=>n.id===resolution.backupId);
  assert.ok(safety.deletedAt,'Cópia mantém estado de eliminação');
  const idx=JSON.parse(cloud.files.get(INDEX).body);
  assert.ok(idx.entries[resolution.backupId].deletedAt);
  assert.equal(db.deserialize(cloud.files.get(idx.entries['old-del'].path).body,owner).content,local.content);
});

test('utilizador pode manter versão Dropbox e preservar integralmente edição local como nova nota',async()=>{
  const cloud=new FakeDropbox();
  const original=basic('choose-remote','<p>Remoto</p>','2026-10-23T10:00:00Z');
  const msi=device(cloud,[original]); await msi.engine.enable();
  const local={...original,content:'<p>Texto diferente no POCO</p>',updatedAt:'2026-10-24T01:00:00Z'};
  const poco=device(cloud,[local]);
  assert.equal((await poco.engine.reconcile()).conflicts.length,1);
  const oldIndex=JSON.parse(cloud.files.get(INDEX).body);
  const originalRev=oldIndex.entries['choose-remote'].rev;
  const done=await poco.engine.resolveWithRemote('choose-remote');
  const localBackup=poco.items.find(n=>n.id===done.backupId);
  assert.ok(localBackup);
  assert.equal(localBackup.content,local.content);
  const newIndex=JSON.parse(cloud.files.get(INDEX).body);
  assert.equal(newIndex.entries['choose-remote'].rev,originalRev,'Versão Dropbox não foi substituída');
  assert.equal(db.deserialize(cloud.files.get(newIndex.entries[done.backupId].path).body,owner).content,local.content);
  assert.equal(poco.items.find(n=>n.id==='choose-remote').content,original.content);
  assert.ok(Date.parse(poco.items.find(n=>n.id==='choose-remote').updatedAt)>Date.parse(local.updatedAt));
  const after=await poco.engine.reconcile();
  assert.equal(after.conflicts.length,0);
  assert.equal(after.pushed,0);
});
test('quando Dropbox eliminou nota, a escolha remota mantém a eliminação e preserva conteúdo local',async()=>{
  const cloud=new FakeDropbox();
  const remote={...basic('choose-tombstone','<div data-notas-purged="1"></div>'),'deletedAt':'2026-09-22T09:51:40.342Z'};
  const a=device(cloud,[remote]);await a.engine.enable();
  const prior={...remote,content:'<p>Texto que estava ativo no POCO</p>',deletedAt:null,updatedAt:'2026-10-24T01:00:00Z'};
  const b=device(cloud,[prior]);
  assert.equal((await b.engine.reconcile()).conflicts.length,1);
  const result=await b.engine.resolveWithRemote('choose-tombstone');
  const original=b.items.find(n=>n.id==='choose-tombstone');
  const copy=b.items.find(n=>n.id===result.backupId);
  assert.ok(original.deletedAt,'A nota eliminada continua eliminada');
  assert.equal(copy.content,prior.content,'Conteúdo local guardado');
  assert.equal(copy.deletedAt,null,'Backup do conteúdo ativo continua acessível');
  assert.equal((await b.engine.reconcile()).conflicts.length,0);
});
test('falha ao fazer upload do backup local impede substituir a edição do dispositivo',async()=>{
  const cloud=new FakeDropbox();
  const remote=basic('fail-local-copy','Remoto');
  const a=device(cloud,[remote]);await a.engine.enable();
  const local={...remote,content:'Local',updatedAt:'2026-10-24T01:00:00Z'};
  const b=device(cloud,[local]);
  const cloudUpload=cloud.upload.bind(cloud);
  cloud.upload=async(path,body,revision)=>{
    if(path.endsWith('.keepnote.json')&&!revision)
      throw cloud.error(503,'Falha sintética durante backup local');
    return cloudUpload(path,body,revision);
  };
  await assert.rejects(()=>b.engine.resolveWithRemote('fail-local-copy'),/Falha sintética/);
  assert.equal(b.items.find(n=>n.id==='fail-local-copy').content,'Local');
  const index=JSON.parse(cloud.files.get(INDEX).body);
  assert.equal(db.deserialize(cloud.files.get(index.entries['fail-local-copy'].path).body,owner).content,'Remoto');
  assert.ok(b.items.some(n=>n.id!=='fail-local-copy'&&n.content==='Local'),'Cópia local ainda existe');
});
test('não aceita a versão Dropbox se a revisão mudar durante a preservação da cópia',async()=>{
  const cloud=new FakeDropbox();
  const remote=basic('race','Versão remota inicial');
  const a=device(cloud,[remote]);await a.engine.enable();
  const local={...remote,content:'Outra edição no POCO',updatedAt:'2026-10-24T01:00:00Z'};
  const b=device(cloud,[local]);
  const originalUpload=cloud.upload.bind(cloud);
  let changed=false;
  cloud.upload=async(path,body,rev)=>{
    const result=await originalUpload(path,body,rev);
    if(!changed && path.endsWith('.keepnote.json') && !rev && !path.includes('--race.')) {
      changed=true;
      const entry=JSON.parse(cloud.files.get(INDEX).body).entries.race;
      const newNote={...remote,content:'Remoto atualizado entretanto',updatedAt:'2026-10-24T02:00:00Z'};
      const metadata=await originalUpload(entry.path,db.serialize(newNote,owner,'https://example.invalid'),entry.rev);
      const manifest=JSON.parse(cloud.files.get(INDEX).body);
      manifest.entries.race.rev=metadata.rev;
      await originalUpload(INDEX,JSON.stringify(manifest),cloud.files.get(INDEX).rev);
    }
    return result;
  };
  await assert.rejects(()=>b.engine.resolveWithRemote('race'),/mudou entretanto/);
  assert.equal(b.items.find(n=>n.id==='race').content,'Outra edição no POCO');
});
