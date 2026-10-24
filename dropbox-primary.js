/* Local-first Dropbox primary store. No network calls or user data are accessed at module load.
 * Each note has an immutable Dropbox path until explicitly relocated. Remote updates use
 * revision compare-and-swap; an account-owned index maps stable IDs to note files.
 * Never silently choose a winner when two devices edit the same note.
 */
(function(root) {
  'use strict';
  const FORMAT='notas-exclusivas-pro/dropbox-index-v1';
  const ROOT='/Bloco de Notas Pro';
  const DEFAULT_FOLDER=ROOT+'/Notas';
  const INDEX=ROOT+'/.keep-notes-index.json';
  const PRIMARY_KEY='notas-pro:dropbox-primary:v1:';
  const MAP_KEY='notas-pro:dropbox-primary-map:v1:';
  const absent=err=>err && err.status===409 && /not_found|not found/i.test(err.details||'');
  const conflict=message=>Object.assign(new Error(message),{code:'DROPBOX_CONFLICT'});
  const cleanNote=n=>({
    id:n.id,title:String(n.title||''),titleHtml:String(n.titleHtml||''),
    content:n.content,updatedAt:n.updatedAt,deletedAt:n.deletedAt||null
  });
  function checkNote(n) {
    if(!n || typeof n.id!=='string' || !n.id || typeof n.content!=='string' ||
      Number.isNaN(Date.parse(n.updatedAt||'')))throw new Error('Nota Dropbox inválida');
    return cleanNote(n);
  }
  function sameEntry(a,b) {
    return (!a&&!b)||!!(a&&b&&a.path===b.path&&a.rev===b.rev);
  }
  function hasNoteId(filename,id) {
    const match=/--([a-zA-Z0-9_-]+)\.keepnote\.json$/i.exec(String(filename||''));
    return match && match[1]===id.replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,90);
  }
  async function hashValue(value) {
    const bytes=new TextEncoder().encode(JSON.stringify(value));
    const digest=await root.crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function normalizedDate(value) {
    if(!value)return null;
    const stamp=Date.parse(value);
    return Number.isFinite(stamp)?stamp:String(value);
  }
  async function fingerprint(note) {
    const n=checkNote(note);
    // Equal instants are equivalent even when Supabase serializes .980Z
    // and Dropbox stores .98+00:00. Content and all other fields still
    // require exact equality before any no-conflict conclusion.
    return hashValue([n.id,n.title,n.titleHtml,n.content,
      normalizedDate(n.updatedAt),normalizedDate(n.deletedAt)]);
  }
  async function fingerprintLegacy(note) {
    const n=checkNote(note);
    return hashValue([n.id,n.title,n.titleHtml,n.content,n.updatedAt,n.deletedAt]);
  }
  async function matchesCheckpoint(note,known,normalizedHash) {
    if(!known)return false;
    if(known.hash) {
      return known.hash===normalizedHash ||
        known.hash===await fingerprintLegacy(note);
    }
    return normalizedDate(note.updatedAt)===normalizedDate(known.syncedAt);
  }
  class Primary {
    constructor({owner,client,getNotes,importNote,applyRemote,storage}) {
      if(!owner||typeof client!=='function'||typeof getNotes!=='function'||
        typeof importNote!=='function'||typeof applyRemote!=='function')throw new Error('Integração Dropbox incompleta');
      this.owner=owner;this.client=client;this.getNotes=getNotes;
      this.importNote=importNote;this.applyRemote=applyRemote;
      this.storage=storage||root.localStorage;
      this.mapKey=MAP_KEY+owner;
      this.itemKey=this.mapKey+':note:';
      this.primaryKey=PRIMARY_KEY+owner;
      this.flight=null;
    }
    enabled(){return this.storage.getItem(this.primaryKey)==='1';}
    setEnabled(value){if(value)this.storage.setItem(this.primaryKey,'1');else this.storage.removeItem(this.primaryKey);}
    readMap(){
      // Historical checkpoints live in a single JSON object. Two open tabs
      // could previously overwrite each other's entire object from stale reads.
      // Per-note checkpoints avoid lost updates between different note IDs.
      let legacy={};
      try {
        const parsed=JSON.parse(this.storage.getItem(this.mapKey)||'{}');
        if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))legacy=parsed;
      } catch (_) {}
      const result={...legacy};
      for(const note of this.getNotes()){
        if(!note?.id)continue;
        try {
          const value=this.storage.getItem(this.itemKey+note.id);
          if(!value)continue;
          const checkpoint=JSON.parse(value);
          if(checkpoint&&typeof checkpoint==='object'&&
            typeof checkpoint.path==='string'&&typeof checkpoint.rev==='string') {
            result[note.id]=checkpoint;
          }
        } catch (_) {}
      }
      return result;
    }
    saveMap(map,id){
      if(!id||!map?.[id]||typeof map[id].path!=='string'||typeof map[id].rev!=='string')
        throw new Error('Checkpoint Dropbox incompleto');
      // Never write back a whole, possibly stale map from another tab.
      this.storage.setItem(this.itemKey+id,JSON.stringify(map[id]));
    }
    async ensureFolder(path) {
      if(!path)return;
      let prefix='';
      for(const part of path.split('/').filter(Boolean)){
        prefix+='/'+part;
        try{await this.client().createFolder(prefix);}
        catch(err) {
          if(err.status!==409)throw err;
          const meta=await this.client().metadata(prefix);
          if(meta['.tag']!=='folder')throw err;
        }
      }
    }
    validateIndex(index) {
      if(!index||index.format!==FORMAT||index.owner!==this.owner||!index.entries||
        typeof index.entries!=='object'||Array.isArray(index.entries)) {
        throw new Error('Índice Dropbox incompatível com esta conta; nenhum ficheiro foi alterado');
      }
      for(const [id,entry] of Object.entries(index.entries)) {
        if(!id||!entry||typeof entry.path!=='string'||typeof entry.rev!=='string'||
          !entry.rev||!hasNoteId(entry.path.split('/').pop(),id)) {
          throw new Error('Índice Dropbox corrompido; sincronização suspensa');
        }
      }
      return index;
    }
    async readIndex(allowCreate) {
      try {
        const metadata=await this.client().metadata(INDEX);
        const raw=await this.client().download(INDEX);
        return {index:this.validateIndex(JSON.parse(raw)),rev:metadata.rev};
      } catch(err) {
        if(!absent(err))throw err;
        if(!allowCreate)return {index:null,rev:null};
      }
      await this.ensureFolder(DEFAULT_FOLDER);
      const index={format:FORMAT,owner:this.owner,entries:{},createdAt:new Date().toISOString()};
      try {
        const metadata=await this.client().upload(INDEX,JSON.stringify(index));
        return {index,rev:metadata.rev};
      }catch(err) {
        if(err.status!==409)throw err;
        return this.readIndex(false);
      }
    }
    async readNote(entry,id) {
      const raw=await this.client().download(entry.path);
      const db=root.NotasDropboxStorage || require('./dropbox-storage.js');
      const note=checkNote(db.deserialize(raw,this.owner));
      if(note.id!==id||!hasNoteId(entry.path.split('/').pop(),id))
        throw conflict('O ficheiro remoto não corresponde ao identificador da nota');
      return note;
    }
    async changeIndex(id,expected,updated) {
      // The index can be changed by another device between read and write.
      // Rebase only if this particular note has NOT changed.
      for(let attempt=0;attempt<5;attempt++){
        const {index,rev}=await this.readIndex(true);
        const actual=index.entries[id]||null;
        if(!sameEntry(actual,expected))throw conflict('Índice alterado noutro dispositivo para esta nota');
        const next={...index,entries:{...index.entries,[id]:updated}};
        try{await this.client().upload(INDEX,JSON.stringify(next),rev);return;}
        catch(err){if(err.status!==409)throw err;}
      }
      throw conflict('Índice Dropbox alterado em simultâneo; tente sincronizar novamente');
    }
    async upload(note,expected,folder,map) {
      const db=root.NotasDropboxStorage || require('./dropbox-storage.js');
      const path=expected?.path || db.notePath(folder||DEFAULT_FOLDER,note);
      await this.ensureFolder(path.slice(0,path.lastIndexOf('/')));
      const raw=db.serialize(note,this.owner,root.location?.origin ? root.location.origin+root.location.pathname : 'https://example.invalid/notas/');
      let metadata;
      try{metadata=await this.client().upload(path,raw,expected?.rev||null);}
      catch(err) {
        if(err.status!==409)throw err;
        // A previous upload may have succeeded but the index write was interrupted.
        // Adopt a matching orphan only; never overwrite mismatched remote contents.
        const currentMeta=await this.client().metadata(path);
        const remote=await this.readNote({path},note.id);
        if(await fingerprint(remote)!==await fingerprint(note))
          throw conflict('O Dropbox contém outra versão da nota. Não foi substituída.');
        metadata=currentMeta;
      }
      const updated={path,rev:metadata.rev,updatedAt:note.updatedAt,deletedAt:note.deletedAt||null};
      await this.changeIndex(note.id,expected,updated);
      map[note.id]={path,rev:metadata.rev,hash:await fingerprint(note),syncedAt:note.updatedAt};
      this.saveMap(map,note.id);
      return updated;
    }
    async reconcile(options={}) {
      if(this.flight)return this.flight;
      this.flight=this._reconcile(options);
      try{return await this.flight;}
      finally{this.flight=null;}
    }
    async _reconcile({folder=DEFAULT_FOLDER}={}) {
      const result={pushed:0,pulled:0,unchanged:0,conflicts:[],pending:[]};
      const manifest=await this.readIndex(true);
      const entries=manifest.index.entries;
      const map=this.readMap();
      const remoteEntries=Object.entries(entries);
      for(const [id,entry] of remoteEntries){
        const local=this.getNotes().find(n=>n.id===id);
        const known=map[id];
        try {
          // Index and saved checkpoint agree: no remote change.
          if(known && sameEntry(known,entry)) {
            if(!local) {
              const remote=await this.readNote(entry,id);
              if(!this.importNote(remote))throw conflict('Não foi possível recuperar a nota no dispositivo');
              map[id]={path:entry.path,rev:entry.rev,hash:await fingerprint(remote),syncedAt:remote.updatedAt};
              this.saveMap(map,id);result.pulled++;
              continue;
            }
            const localHash=await fingerprint(local);
            if(await matchesCheckpoint(local,known,localHash)){
              // Migrate old raw-timestamp checkpoints without uploading data.
              if(known.hash!==localHash) {
                map[id]={...known,hash:localHash};
                this.saveMap(map,id);
              }
              result.unchanged++;continue;
            }
            await this.upload(local,entry,folder,map);result.pushed++;continue;
          }
          // Remote changed. Pull only if local remains exactly as it was last synced.
          const remote=await this.readNote(entry,id);
          const remoteHash=await fingerprint(remote);
          if(!local) {
            if(!this.importNote(remote))throw conflict('A importação desta nota foi recusada');
            result.pulled++;
          } else {
            const localHash=await fingerprint(local);
            if(localHash!==remoteHash) {
              const clean=await matchesCheckpoint(local,known,localHash);
              if(!clean)throw conflict('Alterações diferentes em dois dispositivos; requer revisão');
              if(!this.applyRemote(remote,local))throw conflict('A nota local tem alterações por guardar ou uma versão mais recente');
              result.pulled++;
            } else result.unchanged++;
          }
          map[id]={path:entry.path,rev:entry.rev,hash:remoteHash,syncedAt:remote.updatedAt};
          this.saveMap(map,id);
        }catch(err) {
          if(err.code!=='DROPBOX_CONFLICT')throw err;
          result.conflicts.push({id,message:err.message});
        }
      }
      for(const note of this.getNotes()){
        if(entries[note.id])continue;
        try{await this.upload(note,null,folder,map);result.pushed++;}
        catch(err){
          if(err.code!=='DROPBOX_CONFLICT')throw err;
          result.conflicts.push({id:note.id,message:err.message});
        }
      }
      return result;
    }
    async placeInFolder(note,folder) {
      if(!this.enabled())throw new Error('Ative primeiro o armazenamento principal Dropbox');
      const db=root.NotasDropboxStorage || require('./dropbox-storage.js');
      const normalized=db.folderPath(folder);
      if(!normalized)throw new Error('Escolha uma pasta Dropbox');
      const sync=await this.reconcile();
      if(sync.conflicts.some(c=>c.id===note.id))
        throw conflict('Esta nota tem alterações divergentes; resolva o conflito antes de mover');
      const {index}=await this.readIndex(false);
      const old=index.entries[note.id];
      if(!old)throw new Error('A nota ainda não foi sincronizada');
      const path=db.notePath(normalized,note);
      if(old.path===path)return {path,oldPath:null};
      const remote=await this.readNote(old,note.id);
      if(await fingerprint(remote)!==await fingerprint(note))
        throw conflict('A nota foi alterada no Dropbox durante a operação');
      await this.ensureFolder(normalized);
      let meta;
      const payload=db.serialize(note,this.owner,root.location?.origin
        ?root.location.origin+root.location.pathname:'https://example.invalid/notas/');
      try{meta=await this.client().upload(path,payload);}
      catch(err){
        if(err.status!==409)throw err;
        meta=await this.client().metadata(path);
        const existing=await this.readNote({path},note.id);
        if(await fingerprint(existing)!==await fingerprint(note))
          throw conflict('A pasta escolhida já contém uma versão diferente da nota');
      }
      const replacement={path,rev:meta.rev,updatedAt:note.updatedAt,deletedAt:note.deletedAt||null};
      await this.changeIndex(note.id,old,replacement);
      const map=this.readMap();
      map[note.id]={path,rev:meta.rev,hash:await fingerprint(note),syncedAt:note.updatedAt};
      this.saveMap(map,note.id);
      // Retain the previous copy as a recoverable historical file, never delete it silently.
      return {path,oldPath:old.path};
    }
    async inspectConflict(id) {
      const {index}=await this.readIndex(false);
      const entry=index?.entries?.[id];
      const local=this.getNotes().find(n=>n.id===id);
      if(!entry||!local)throw new Error('A nota em conflito já não está disponível');
      const remote=await this.readNote(entry,id);
      return {
        local, remote,
        localHash:await fingerprint(local),
        remoteHash:await fingerprint(remote),
        remoteRevision:entry.rev
      };
    }
    async resolveWithLocal(id) {
      const compared=await this.inspectConflict(id);
      if(compared.localHash===compared.remoteHash) {
        throw new Error('As versões já são iguais. Sincronize novamente em vez de criar duplicados.');
      }
      const backup={
        ...compared.remote,
        id:root.crypto.randomUUID(),
        title:'Cópia da versão Dropbox - '+(compared.remote.title||'Sem título'),
        updatedAt:new Date().toISOString(),
        deletedAt:null
      };
      if(!this.importNote(backup)) throw new Error('Não foi possível guardar localmente a cópia da nuvem');
      // Store a separately indexed Dropbox copy BEFORE replacing the existing version.
      // An interrupted upload must not destroy the only remote copy.
      await this.upload(backup,null,DEFAULT_FOLDER,this.readMap());
      const savedNow=this.getNotes().find(n=>n.id===id);
      if(!savedNow || await fingerprint(savedNow)!==compared.localHash) {
        throw conflict('A nota local mudou durante a comparação. A versão remota foi preservada, mas a nota original não foi substituída.');
      }
      const latestIndex=await this.readIndex(false);
      const entry=latestIndex.index?.entries?.[id];
      if(!entry || entry.rev!==compared.remoteRevision) {
        throw conflict('A versão Dropbox mudou durante a operação. A cópia de segurança foi preservada.');
      }
      await this.upload(savedNow,entry,DEFAULT_FOLDER,this.readMap());
      return {backupId:backup.id,noteId:id};
    }
    async enable() {
      const result=await this.reconcile();
      if(result.conflicts.length)throw conflict('Existem conflitos não resolvidos. O Dropbox principal não foi ativado.');
      // Do not switch remote authority until EVERY local note is indexed.
      const {index}=await this.readIndex(false);
      for(const note of this.getNotes())if(!index.entries[note.id])
        throw new Error('Migração incompleta; a aplicação continua no modo anterior');
      this.setEnabled(true);
      return result;
    }
  }
  const API=Object.freeze({Primary,FORMAT,ROOT,DEFAULT_FOLDER,INDEX,PRIMARY_KEY,MAP_KEY,fingerprint});
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  else root.NotasDropboxPrimary=API;
})(globalThis);
