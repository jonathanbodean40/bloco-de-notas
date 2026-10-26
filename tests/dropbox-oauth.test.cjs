'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DropboxOAuth} = require('../dropbox-oauth.js');
const storage = () => {
  const data = new Map();
  return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
};
const location = new URL('https://example.invalid/bloco-de-notas/?note=synthetic-note&scope=synthetic');
const owner='synthetic';
const appKey='synthetic-app-key';
const reply = data=>({ok:true,json:async()=>data});
test('OAuth PKCE utiliza state, code challenge e redirecionamento seguro',async()=>{
  const saved=storage();
  const oauth=new DropboxOAuth({owner,appKey,storage:saved,location,fetchImpl:async()=>reply({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:14400})});
  const start=new URL(await oauth.begin(location.href));
  assert.equal(start.searchParams.get('response_type'),'code');
  assert.equal(start.searchParams.get('code_challenge_method'),'S256');
  assert.equal(start.searchParams.get('client_id'),appKey);
  assert.ok(start.searchParams.get('code_challenge').length>=40);
  assert.equal(start.searchParams.get('token_access_type'),'offline');
  assert.deepEqual(new Set(start.searchParams.get('scope').split(' ')),new Set([
    'files.content.read','files.content.write','files.metadata.read','files.metadata.write','account_info.read'
  ]));
  assert.ok(!oauth.connected());
  const state=start.searchParams.get('state');
  const back=await oauth.finish('?code=synthetic-code&state='+state);
  assert.equal(back,location.href);
  assert.ok(oauth.connected());
  assert.equal(await oauth.getToken(),'synthetic-access');
  oauth.disconnect();
  assert.equal(oauth.connected(),false);
});
test('rejeita callbacks sem state correto',async()=>{
  const saved=storage();
  let calls=0;
  const oauth=new DropboxOAuth({owner,appKey,storage:saved,location,fetchImpl:async()=>{calls++;return reply({});}});
  await oauth.begin(location.href);
  await assert.rejects(()=>oauth.finish('?code=synthetic-code&state=bad'),/falhou/);
  assert.equal(calls,0);
});
test('renova sessões vencidas apenas no armazenamento da aba',async()=>{
  const saved=storage();
  const oauth=new DropboxOAuth({owner,appKey,storage:saved,location,fetchImpl:async(url,options)=>{
    const form=new URLSearchParams(options.body);
    if(form.get('grant_type')==='refresh_token')return reply({access_token:'synthetic-new-access',expires_in:14400});
    return reply({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:1});
  }});
  const state=new URL(await oauth.begin(location.href)).searchParams.get('state');
  await oauth.finish('?code=synthetic-code&state='+state);
  assert.equal(await oauth.getToken(),'synthetic-new-access');
  assert.equal(await oauth.getToken(),'synthetic-new-access');
});
test('recupera autorização persistente e não pede login em cada nova sessão',async()=>{
  const saved=storage();
  const calls=[];
  const vault={
    async restore(){calls.push('restore');return {refreshToken:'saved-refresh-token',accountId:'synthetic-account'};},
    async forget(){calls.push('forget');}
  };
  globalThis.NotasDropboxTokenVault=vault;
  try{
    const oauth=new DropboxOAuth({owner,appKey,storage:saved,location,fetchImpl:async(url,options)=>{
      const form=new URLSearchParams(options.body);
      assert.equal(form.get('grant_type'),'refresh_token');
      assert.equal(form.get('refresh_token'),'saved-refresh-token');
      return reply({access_token:'refreshed-access',expires_in:14400});
    }});
    assert.equal(await oauth.restorePersistent(),true);
    assert.equal(await oauth.getToken(),'refreshed-access');
    oauth.suspend();
    assert.equal(oauth.connected(),false);
    assert.equal(calls.includes('forget'),false,'Bloqueio temporário não deve eliminar o vault');
    assert.equal(await oauth.restorePersistent(),true);
    assert.equal(await oauth.getToken(),'refreshed-access');
    oauth.disconnect();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(calls.includes('forget'),true,'Só desligar explicitamente elimina o vault');
  }finally{delete globalThis.NotasDropboxTokenVault;}
});
test('sessão antiga com refresh_token objeto é recusada e recuperada do vault',async()=>{
  const saved=storage();
  const bad='notas-pro-dropbox-pkce-v1:'+owner+':'+appKey+':tokens';
  saved.setItem(bad,JSON.stringify({refresh_token:{refreshToken:'broken-old'}}));
  globalThis.NotasDropboxTokenVault={
    async restore(){return {refreshToken:'correct-stored-token'};},
    async forget(){}
  };
  try{
    const oauth=new DropboxOAuth({owner,appKey,storage:saved,location,fetchImpl:async(url,options)=>{
      assert.equal(new URLSearchParams(options.body).get('refresh_token'),'correct-stored-token');
      return reply({access_token:'recovered',expires_in:14400});
    }});
    assert.equal(oauth.connected(),false);
    assert.equal(await oauth.restorePersistent(),true);
    assert.equal(await oauth.getToken(),'recovered');
  }finally{delete globalThis.NotasDropboxTokenVault;}
});
