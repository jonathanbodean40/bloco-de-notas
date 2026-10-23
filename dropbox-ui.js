/* Private UI binding for optional Dropbox backups. No automatic full migration.
 * All writes start from a confirmed local save; remote CAS protects revisions.
 */
(function (root) {
  'use strict';
  function create({owner, getNote, ensureSaved, getActiveId, getCurrentOwner, openNote, currentUrl}) {
    if (!root.NotasDropboxStorage || !root.NotasDropboxOAuth) throw new Error('Módulos Dropbox indisponíveis');
    const db = root.NotasDropboxStorage;
    const Auth = root.NotasDropboxOAuth.DropboxOAuth;
    const $ = id => document.getElementById(id);
    const box = $('dropbox-dialog');
    const keyInput = $('dropbox-key');
    const folderInput = $('dropbox-folder');
    const status = $('dropbox-status');
    const list = $('dropbox-folders');
    const mappingsKey = 'notas-pro:dropbox-mappings:v1:' + owner;
    const appKeyKey = 'notas-pro:dropbox-app-key:v1';
    const folderKey = 'notas-pro:dropbox-folder:v1:' + owner;
    let selectedId = null;
    let oauth = null;
    let flight = null;
    const pending = new Map();
    const waiting = new Set();
    keyInput.value = localStorage.getItem(appKeyKey) || root.NOTAS_CONFIG?.dropboxAppKey || '';
    folderInput.value = localStorage.getItem(folderKey) || '/Notas Pro';
    const readMap = () => {
      try {
        const value = JSON.parse(localStorage.getItem(mappingsKey) || '{}');
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (_) { return {}; }
    };
    function saveMap(value) { localStorage.setItem(mappingsKey, JSON.stringify(value)); }
    function say(message) { status.textContent = message; }
    function makeAuth() {
      if (getCurrentOwner() !== owner) throw new Error('A conta autorizada foi alterada; recarregue a aplicação');
      const key = keyInput.value.trim();
      if (!/^[a-zA-Z0-9]{6,60}$/.test(key)) throw new Error('Indique a chave pública da aplicação Dropbox');
      if (!oauth || oauth.appKey !== key) oauth = new Auth({owner, appKey:key});
      return oauth;
    }
    // Resume a Dropbox session already active in this browser tab.
    try { if (keyInput.value.trim()) makeAuth(); } catch (_) {}
    function client() {
      const auth = makeAuth();
      if (!auth.connected()) throw new Error('É necessário ligar o Dropbox nesta sessão');
      return new db.Client({getToken:() => auth.getToken()});
    }
    function safeFolder() {
      const path = db.folderPath(folderInput.value.trim());
      if (!path) throw new Error('Selecione uma pasta dentro do Dropbox');
      return path;
    }
    function currentNote() {
      if (!selectedId) throw new Error('Abra primeiro uma nota');
      const note = getNote(selectedId);
      if (!note || note.deletedAt) throw new Error('A nota não foi encontrada');
      return note;
    }
    async function backup(id, explicit) {
      if (getCurrentOwner() !== owner || !root.NOTAS_PRIVATE?.authorized) throw new Error('Conta não autorizada');
      if (flight) {
        if (explicit) throw new Error('Aguarde a conclusão do envio anterior');
        waiting.add(id);
        return;
      }
      flight = (async () => {
        const note = getNote(id);
        if (!note || note.deletedAt) return;
        const map = readMap(), previous = map[id];
        if (!explicit && (!previous || previous.syncedAt === note.updatedAt)) return;
        const folder = explicit ? safeFolder() : previous?.folder;
        const path = previous && previous.folder === folder ? previous.path : db.notePath(folder, note);
        const revision = previous && previous.path === path ? previous.rev : null;
        const raw = db.serialize(note, owner, currentUrl);
        const result = await client().upload(path, raw, revision);
        const latest = getNote(id);
        map[id] = {path, folder, rev: result.rev, syncedAt: note.updatedAt, updated: new Date().toISOString()};
        saveMap(map);
        if (selectedId === id) say('Guardado no Dropbox: ' + path);
        // If a save occurred during upload, transmit its newer revision next.
        if (latest && latest.updatedAt !== note.updatedAt) waiting.add(id);
      })();
      try { await flight; }
      finally {
        flight = null;
        const ids = [...waiting]; waiting.clear();
        for (const noteId of ids) queue(noteId);
      }
    }
    function queue(id) {
      if (getCurrentOwner() !== owner || !readMap()[id]) return;
      if (pending.has(id)) clearTimeout(pending.get(id));
      if (!oauth?.connected()) return;
      const timer = setTimeout(() => {
        pending.delete(id);
        backup(id, false).catch(err => {
          if (selectedId === id) say('Dropbox pendente: ' + (err.status === 409 ? 'há um conflito de versões' : err.message));
        });
      }, 2000);
      pending.set(id, timer);
    }
    function retryMapped() {
      if (!oauth?.connected() || getCurrentOwner() !== owner) return;
      for (const [id, mapping] of Object.entries(readMap())) {
        const note = getNote(id);
        if (note && note.updatedAt !== mapping.syncedAt) queue(id);
      }
    }
    function open(id) {
      if (getCurrentOwner() !== owner) return;
      selectedId = id || null;
      const note = id && getNote(id);
      $('dropbox-selected-note').textContent = note ? 'Nota: ' + (note.title || 'Sem título') : 'Escolha uma nota primeiro';
      const map = id && readMap()[id];
      if (map?.folder) folderInput.value = map.folder;
      say(oauth?.connected() ? 'Dropbox ligado nesta sessão' : 'Dropbox não ligado');
      box.showModal();
    }
    function close() { box.close(); }
    async function connect() {
      const auth = makeAuth();
      localStorage.setItem(appKeyKey, keyInput.value.trim());
      localStorage.setItem(folderKey, folderInput.value.trim());
      const authorizeUrl = await auth.begin(root.location.href);
      // Explicit user action. No silent login or hidden Dropbox permission.
      root.location.assign(authorizeUrl);
    }
    async function resume() {
      if (!new URLSearchParams(root.location.search).has('code')) return false;
      const auth = makeAuth();
      const destination = await auth.finish();
      if (destination) {
        root.location.replace(destination);
        return true;
      }
      return false;
    }
    async function listFolders() {
      const folder = db.folderPath(folderInput.value.trim());
      say('A procurar subpastas…');
      const items = await client().listFolder(folder);
      list.replaceChildren();
      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = '↑ Pasta anterior';
      up.addEventListener('click', () => {
        const p = folder.split('/').slice(0, -1).join('/');
        folderInput.value = p || '/';
        listFolders().catch(err => say(err.message));
      });
      list.append(up);
      for (const entry of items.filter(item => item['.tag'] === 'folder')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '📁 ' + entry.name;
        button.addEventListener('click', () => {
          folderInput.value = entry.path_display;
          listFolders().catch(err => say(err.message));
        });
        list.append(button);
      }
      for (const entry of items.filter(item => item['.tag'] === 'file' && /\.keepnote\.json$/i.test(item.name))) {
        const match = /--([a-zA-Z0-9_-]+)\.keepnote\.json$/i.exec(entry.name);
        if (!match) continue;
        const note = getNote(match[1]);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = (note ? 'Abrir nota: ' : 'Nota remota: ') + entry.name.replace(/--[a-zA-Z0-9_-]+\.keepnote\.json$/i, '');
        if (note) {
          button.addEventListener('click', () => { close(); openNote(note.id); });
        } else {
          button.disabled = true;
          button.title = 'Esta nota ainda não existe no dispositivo; é necessário importar ou sincronizar primeiro';
        }
        list.append(button);
      }
      say('Pasta: ' + (folder || '/'));
    }
    async function createFolder() {
      const path = safeFolder();
      await client().createFolder(path);
      say('Pasta criada: ' + path);
    }
    async function saveSelected() {
      const id = selectedId;
      if (!id) throw new Error('Abra primeiro uma nota');
      if (!ensureSaved(id)) throw new Error('Guarde a nota antes de enviar ao Dropbox');
      currentNote();
      localStorage.setItem(folderKey, folderInput.value.trim());
      await backup(id, true);
    }
    async function recoverSelected() {
      const note = currentNote();
      const map = readMap()[note.id];
      if (!map) throw new Error('Esta nota ainda não tem um ficheiro Dropbox associado');
      const data = db.deserialize(await client().download(map.path), owner);
      const result = db.revisionDecision(note, data, map.rev);
      if (result === 'unchanged') { say('A nota local corresponde à cópia Dropbox'); return; }
      say('Existem versões diferentes. Nenhuma nota foi substituída; é necessária uma revisão manual.');
    }
    async function copyLink() {
      const note = currentNote();
      const url = db.deepLink(currentUrl, owner, note.id);
      await navigator.clipboard.writeText(url);
      say('Ligação direta copiada. Abrir requer autenticação no Bloco de Notas Pro.');
    }
    $('dropbox-btn').addEventListener('click', () => open(getActiveId()));
    $('dropbox-close').addEventListener('click', close);
    const events = [
      ['dropbox-connect',connect],
      ['dropbox-browse',listFolders],
      ['dropbox-create-folder',createFolder],
      ['dropbox-save',saveSelected],
      ['dropbox-recover',recoverSelected],
      ['dropbox-copy-link',copyLink]
    ];
    for (const [id, action] of events) $(id).addEventListener('click', () => {
      Promise.resolve().then(action).catch(err => say(err.status === 409
        ? 'Conflito Dropbox: a versão na nuvem foi alterada e não foi substituída.'
        : err.message || 'Falha na operação'));
    });
    root.addEventListener('online', retryMapped);
    if (oauth?.connected()) setTimeout(retryMapped, 0);
    return Object.freeze({open, queue, resume, retryMapped, connected:() => !!oauth?.connected()});
  }
  const API = Object.freeze({create});
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.NotasDropboxUI = API;
})(globalThis);
