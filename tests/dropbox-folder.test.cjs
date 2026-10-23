'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../dropbox-storage.js');
const reply=(data,status=200)=>({
  ok:status>=200&&status<300,status,
  json:async()=>data,text:async()=>JSON.stringify(data)
});
function fake({preexisting=[''],blocking=null}={}){
  const folders=new Set(preexisting);
  const files=new Map();
  const calls=[];
  const fetch=async(url,options)=>{
    const endpoint=new URL(url).pathname.replace(/^\/2(?=\/files\/)/,'');
    const arg=endpoint==='/files/upload'
      ? JSON.parse(options.headers['Dropbox-API-Arg'])
      :JSON.parse(options.body||'{}');
    calls.push({endpoint,path:arg.path,mode:arg.mode});
    if(endpoint==='/files/get_metadata'){
      if(folders.has(arg.path))return reply({'.tag':'folder',path_display:arg.path});
      if(files.has(arg.path))return reply({'.tag':'file',rev:'revision-existing'});
      return reply({error_summary:'path/not_found/...'},409);
    }
    if(endpoint==='/files/create_folder_v2'){
      if(blocking==='permission')return reply({error_summary:'path/no_write_permission/...'},409);
      const parent=arg.path.slice(0,arg.path.lastIndexOf('/'));
      if(!folders.has(parent))return reply({error_summary:'path/not_found/...'},409);
      if(folders.has(arg.path)||files.has(arg.path))
        return reply({error_summary:'path/conflict/folder/...'},409);
      folders.add(arg.path);
      return reply({metadata:{'.tag':'folder',path_display:arg.path}});
    }
    if(endpoint==='/files/upload'){
      const parent=arg.path.slice(0,arg.path.lastIndexOf('/'));
      if(!folders.has(parent))return reply({error_summary:'path/not_found/...'},409);
      if(files.has(arg.path)&&!arg.mode?.update)
        return reply({error_summary:'path/conflict/file/...'},409);
      if(files.has(arg.path)&&arg.mode?.update!=='revision-existing')
        return reply({error_summary:'path/conflict/file/...'},409);
      files.set(arg.path,options.body);
      return reply({rev:'revision-existing',path_display:arg.path});
    }
    throw new Error('Endpoint inesperado: '+endpoint);
  };
  return {fetch,folders,files,calls};
}
const client=fetch=>new db.Client({getToken:async()=>'synthetic-token',fetch});
test('erro HTTP 409 distingue pasta inexistente, ficheiro em conflito e permissões',()=>{
  const e=raw=>new db.DropboxError('Dropbox devolveu HTTP 409',409,JSON.stringify({error_summary:raw}));
  assert.equal(db.errorKind(e('path/not_found/...')),'missing');
  assert.equal(db.errorKind(e('path/conflict/file/...')),'conflict');
  assert.equal(db.errorKind(e('path/no_write_permission/...')),'permission');
  assert.match(db.userMessage(e('path/not_found/...')),/não existe/);
  assert.match(db.userMessage(e('path/conflict/file/...')),/foi alterado/);
  assert.doesNotMatch(db.userMessage(e('path/not_found/...')),/versão na nuvem foi alterada/);
});
test('guarda pasta inexistente selecionada pelo utilizador sem substituir nenhum ficheiro',async()=>{
  const api=fake(),remote=client(api.fetch);
  const target='/Notas Pro';
  await assert.rejects(()=>remote.upload(target+'/nota.keepnote.json','sintetico'),
    error=>db.errorKind(error)==='missing');
  const checked=await remote.ensureFolder(target);
  assert.deepEqual(checked.created,[target]);
  assert.equal(api.folders.has(target),true);
  const result=await remote.upload(target+'/nota.keepnote.json','sintetico');
  assert.equal(result.rev,'revision-existing');
  assert.equal(api.files.size,1);
  assert.deepEqual((await remote.ensureFolder(target)).created,[]);
  assert.equal(api.files.size,1);
});
test('pastas aninhadas só são criadas após validação e nunca são apagadas',async()=>{
  const api=fake(),remote=client(api.fetch);
  const result=await remote.ensureFolder('/Bloco de Notas Pro/Testes OAuth');
  assert.deepEqual(result.created,['/Bloco de Notas Pro','/Bloco de Notas Pro/Testes OAuth']);
  assert.deepEqual((await remote.ensureFolder('/Bloco de Notas Pro/Testes OAuth')).created,[]);
  assert.equal(api.files.size,0);
});
test('ficheiro com o mesmo nome bloqueia criação de pasta',async()=>{
  const api=fake();
  api.files.set('/Notas Pro',new Uint8Array(10));
  await assert.rejects(()=>client(api.fetch).ensureFolder('/Notas Pro'),/não uma pasta/);
  assert.equal(api.folders.has('/Notas Pro'),false);
});
test('sem permissão não cria a pasta e não inventa conflito de versões',async()=>{
  const api=fake({blocking:'permission'});
  await assert.rejects(()=>client(api.fetch).ensureFolder('/Notas Pro'),
    err=>db.errorKind(err)==='permission');
  assert.equal(api.folders.has('/Notas Pro'),false);
  assert.equal(api.calls.some(x=>x.endpoint==='/files/upload'),false);
});
test('ficheiro existente sem revisão conhecida nunca é sobrescrito',async()=>{
  const api=fake({preexisting:['','/Notas Pro']}),remote=client(api.fetch);
  api.files.set('/Notas Pro/nota.keepnote.json',new Uint8Array([1,2,3]));
  await remote.ensureFolder('/Notas Pro');
  await assert.rejects(()=>remote.upload('/Notas Pro/nota.keepnote.json','novo'),
    err=>db.errorKind(err)==='conflict');
  assert.deepEqual([...api.files.get('/Notas Pro/nota.keepnote.json')],[1,2,3]);
});
