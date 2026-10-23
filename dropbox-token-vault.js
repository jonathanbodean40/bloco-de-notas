/* Optional persistent Dropbox OAuth refresh-token storage for this authorized browser.
 * Encrypted at rest with a non-extractable WebCrypto key held in IndexedDB.
 * This protects against casual storage inspection, NOT malicious scripts in the same origin.
 * Call only after private application authentication. Never place tokens in public files.
 */
(function(root){
  'use strict';
  const DATABASE='notas-pro-dropbox-auth-v1';
  const STORE='items';
  function open(){
    return new Promise((resolve,reject)=>{
      if(!root.indexedDB||!root.crypto?.subtle){reject(new Error('Armazenamento seguro indisponível'));return;}
      const request=root.indexedDB.open(DATABASE,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(STORE);
      request.onerror=()=>reject(request.error || new Error('Falha no armazenamento da sessão'));
      request.onsuccess=()=>resolve(request.result);
    });
  }
  async function operation(mode,key,value){
    const db=await open();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
        const req=mode==='readonly'?store.get(key):
          value===undefined?store.delete(key):store.put(value,key);
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error||new Error('Operação da sessão falhou'));
        tx.onerror=()=>reject(tx.error||new Error('Transação da sessão falhou'));
      });
    }finally{db.close();}
  }
  const base=(owner,appKey)=>{
    if(!/^[a-zA-Z0-9_-]+$/.test(owner)||!/^[a-zA-Z0-9]{6,60}$/.test(appKey))
      throw new TypeError('Identificador da sessão inválido');
    return 'owner:'+owner+':app:'+appKey;
  };
  async function remember(owner,appKey,refreshToken,accountId=''){
    if(typeof refreshToken!=='string'||!refreshToken)throw new TypeError('Token Dropbox inválido');
    const name=base(owner,appKey);
    let key=await operation('readonly',name+':key');
    if(!key){
      key=await root.crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
      await operation('readwrite',name+':key',key);
    }
    const iv=root.crypto.getRandomValues(new Uint8Array(12));
    const bytes=new TextEncoder().encode(JSON.stringify({owner,appKey,refreshToken}));
    const cipher=await root.crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);
    await operation('readwrite',name+':tokens',{iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher))});
    return true;
  }
  async function restore(owner,appKey){
    const name=base(owner,appKey);
    const [key,record]=await Promise.all([
      operation('readonly',name+':key'),operation('readonly',name+':tokens')
    ]);
    if(!key||!record)return null;
    const bytes=await root.crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(record.iv)},
      key,new Uint8Array(record.cipher));
    const data=JSON.parse(new TextDecoder().decode(bytes));
    if(data.owner!==owner||data.appKey!==appKey||!data.refreshToken)
      throw new Error('Sessão Dropbox de outro utilizador');
    return data.refreshToken;
  }
  async function forget(owner,appKey){
    const name=base(owner,appKey);
    await operation('readwrite',name+':tokens',undefined);
    await operation('readwrite',name+':key',undefined);
  }
  const API=Object.freeze({remember,restore,forget});
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  else root.NotasDropboxTokenVault=API;
})(globalThis);
