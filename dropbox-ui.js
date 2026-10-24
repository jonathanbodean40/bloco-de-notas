/* Private UI binding for optional Dropbox backups. No automatic full migration.
 * All writes start from a confirmed local save; remote CAS protects revisions.
 */
(function (root) {
  'use strict';
  function create({owner, getNote, getNotes, importNote, applyRemote, adoptRemote, ensureSaved, prepareActivation, requestSync, getActiveId, getCurrentOwner, openNote, currentUrl}) {
    if (!root.NotasDropboxStorage || !root.NotasDropboxOAuth || !root.NotasDropboxPrimary) throw new Error('Módulos Dropbox indisponíveis');
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
    folderInput.value = localStorage.getItem(folderKey) || '/Bloco de Notas Pro/Notas';
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
    const primary = new root.NotasDropboxPrimary.Primary({
      owner, client, getNotes,
      importNote, applyRemote, adoptRemote, storage:localStorage
    });
    const modeStatus = $('dropbox-primary-status');
    const conflictList = $('dropbox-conflicts');
    const activationFeedback = $('dropbox-activation-feedback');
    let activationBusy = false;
    function showActivationFeedback(message,state='info',reveal=false) {
      activationFeedback.textContent=message;
      activationFeedback.dataset.state=state;
      if(reveal && box.open && typeof activationFeedback.scrollIntoView==='function')
        activationFeedback.scrollIntoView({block:'nearest',behavior:'auto'});
    }
    function renderConflicts(conflicts) {
      conflictList.replaceChildren();
      if (!Array.isArray(conflicts) || !conflicts.length) return;
      const summary=document.createElement('p');
      summary.textContent=conflicts.length+' nota(s) com divergências por analisar. Nenhuma foi substituída.';
      conflictList.append(summary);
      for (const conflict of conflicts) {
        const title = getNotes().find(n => n.id === conflict.id)?.title || 'Sem título';
        const row = document.createElement('div');
        const label = document.createElement('p');
        label.textContent = 'Conflito na nota «' + title + '» (ID …' +
          String(conflict.id).slice(-8) + '): ' + conflict.message;
        const inspect = document.createElement('button');
        inspect.type = 'button';
        inspect.textContent = 'Comparar as duas versões';
        const preview = document.createElement('div');
        preview.hidden = true;
        preview.className = 'dropbox-conflict-comparison';
        inspect.addEventListener('click', async () => {
          inspect.disabled=true;
          try {
            if (getCurrentOwner()!==owner || !root.NOTAS_PRIVATE?.authorized)
              throw new Error('A sessão da conta foi alterada');
            const versions=await primary.inspectConflict(conflict.id);
            preview.replaceChildren();
            const info=document.createElement('p');
            info.textContent='Prévia textual resumida; imagens e elementos gráficos podem não aparecer.';
            preview.append(info);
            const plainText = note => String(note?.content||'')
              .replace(/<[^>]*>/g,' ')
              .replace(/&nbsp;/g,' ')
              .replace(/&amp;/g,'&')
              .replace(/&lt;/g,'<')
              .replace(/&gt;/g,'>')
              .replace(/\s+/g,' ').trim().slice(0,1400);
            for (const [caption,note] of [
              ['Edição guardada neste dispositivo',versions.local],
              ['Versão existente no Dropbox',versions.remote]
            ]) {
              const wrapper=document.createElement('section');
              const h=document.createElement('strong');
              h.textContent=caption;
              const date=document.createElement('p');
              date.textContent='Estado: '+(note.deletedAt?'Eliminada':'Ativa')+
                ' · Data registada: '+(note.updatedAt||'desconhecida')+
                ' · '+String(note.content||'').length+' caracteres de conteúdo';
              const body=document.createElement('pre');
              body.textContent=plainText(note) || '[Conteúdo sem texto simples ou apenas elementos gráficos]';
              wrapper.append(h,date,body);preview.append(wrapper);
            }
            preview.hidden=false;
            inspect.textContent='Atualizar comparação';
          } catch(err) {
            say('Não foi possível comparar as versões: '+(err.message||'erro'));
          } finally { inspect.disabled=false; }
        });
        const action = document.createElement('button');
        action.type = 'button';
        action.textContent = 'Preservar ambas as versões e usar esta edição';
        action.addEventListener('click', async () => {
          if (getCurrentOwner()!==owner || !root.NOTAS_PRIVATE?.authorized) {
            say('A sessão foi alterada; entre novamente antes de resolver o conflito.');return;
          }
          if (!root.confirm('Guardar PRIMEIRO uma cópia separada da versão Dropbox e só DEPOIS manter a edição deste dispositivo na nota original? Ambas as versões ficarão guardadas na nuvem e no dispositivo.')) return;
          action.disabled = true;
          try {
            const resolved = await primary.resolveWithLocal(conflict.id);
            row.remove();
            say('Conflito resolvido; versão da nuvem preservada como nota ' + resolved.backupId);
            requestSync?.();
          } catch(err) {
            action.disabled = false;
            say('Não foi possível resolver: ' + (err.message || 'versão alterada'));
          }
        });
        const chooseDropbox=document.createElement('button');
        chooseDropbox.type='button';
        chooseDropbox.textContent='Manter versão Dropbox e guardar esta edição como cópia';
        chooseDropbox.addEventListener('click',async()=>{
          if(getCurrentOwner()!==owner || !root.NOTAS_PRIVATE?.authorized) {
            say('A sessão foi alterada; entre novamente antes de resolver o conflito.');return;
          }
          if(!root.confirm('Guardar PRIMEIRO uma cópia separada da versão deste dispositivo no Dropbox e SÓ DEPOIS utilizar a versão Dropbox como principal? Nada será apagado.'))return;
          chooseDropbox.disabled=true;
          try {
            const result=await primary.resolveWithRemote(conflict.id);
            row.remove();
            say('Conflito resolvido: cópia deste dispositivo preservada como nota '+result.backupId+'.');
            requestSync?.();
          } catch(err){
            chooseDropbox.disabled=false;
            say('Não foi possível resolver: '+(err?.message||'operação interrompida'));
          }
        });
        row.append(label,inspect,preview,action,chooseDropbox); conflictList.append(row);
      }
    }
    function updateMode(message) {
      const active = primary.enabled();
      modeStatus.textContent = message || (active
        ? 'Dropbox principal ativo neste dispositivo. As notas são gravadas localmente e sincronizadas na nuvem.'
        : 'Armazenamento principal atual preservado. O Dropbox ainda é opcional.');
      $('dropbox-enable-primary').disabled = active || activationBusy;
      $('dropbox-inspect-conflicts').disabled = activationBusy;
      $('dropbox-sync-all').disabled = !active || activationBusy;
    }
    function reportActivation(message,state='info',reveal=false) {
      updateMode(message);
      showActivationFeedback(message,state,reveal);
    }
    updateMode();
    async function inspectBeforeActivation() {
      if(activationBusy)return null;
      activationBusy=true;
      reportActivation('A analisar versões no Dropbox, sem alterar ficheiros…','progress',true);
      try {
        if(!oauth?.connected())throw new Error('Ligue primeiro a sua conta Dropbox.');
        if(getCurrentOwner()!==owner || !root.NOTAS_PRIVATE?.authorized)
          throw new Error('A conta autorizada foi alterada; inicie novamente a sessão.');
        const report=await primary.previewDifferences();
        renderConflicts(report.conflicts);
        if(report.conflicts.length) {
          reportActivation('Existem '+report.conflicts.length+' nota(s) com versões diferentes. Compare-as antes de ativar. Nenhuma nota foi substituída.','warning',true);
        } else {
          reportActivation('Sem divergências de conteúdo. '+report.missingLocal+
            ' nota(s) disponíveis para recuperar do Dropbox; '+report.missingRemote+
            ' nota(s) ainda por enviar após confirmação.','success',true);
        }
        return report;
      } catch(err) {
        reportActivation('Não foi possível verificar os conflitos: '+db.userMessage(err),'error',true);
        return null;
      } finally {
        activationBusy=false;
        updateMode(modeStatus.textContent);
      }
    }
    async function syncPrimary() {
      if (!primary.enabled()) return null;
      if (getCurrentOwner() !== owner || !root.NOTAS_PRIVATE?.authorized) {
        throw new Error('Conta não autorizada para sincronizar');
      }
      if (!oauth?.connected()) {
        throw new Error('Dropbox principal pendente: ligue novamente a sua conta Dropbox');
      }
      const result = await primary.reconcile();
      renderConflicts(result.conflicts);
      if (result.conflicts.length) {
        updateMode(result.conflicts.length + ' conflito(s) entre dispositivos. Nenhuma alteração divergente foi substituída.');
      } else {
        updateMode('Dropbox sincronizado: ' + result.pushed + ' enviadas, ' + result.pulled + ' recuperadas.');
      }
      return result;
    }
    async function enablePrimary() {
      if(activationBusy)return false;
      activationBusy=true;
      reportActivation('A verificar versões no Dropbox antes de qualquer transferência…','progress',true);
      try {
        if(primary.enabled()) {
          reportActivation('Dropbox já está ativo como armazenamento principal neste dispositivo.','success',true);
          return true;
        }
        if(!oauth?.connected())throw new Error('Ligue primeiro a sua conta Dropbox.');
        if(getCurrentOwner()!==owner || !root.NOTAS_PRIVATE?.authorized)
          throw new Error('Conta não autorizada; inicie novamente a sessão.');
        if(typeof prepareActivation!=='function')
          throw new Error('A verificação das cópias de segurança está indisponível.');
        const assessment=await primary.previewDifferences();
        renderConflicts(assessment.conflicts);
        if(assessment.conflicts.length) {
          reportActivation('Ativação bloqueada: '+assessment.conflicts.length+
            ' nota(s) com versões diferentes. Utilize «Comparar as duas versões». Nenhuma nota foi substituída.','warning',true);
          return false;
        }
        reportActivation('A confirmar a sincronização e as cópias de segurança anteriores…','progress',true);
        await prepareActivation();
        if(!root.confirm('Migrar cópias de todas as notas para o Dropbox como armazenamento principal? A versão atual e o Supabase serão preservados como backup, sem eliminar notas.')) {
          reportActivation('Ativação cancelada. Todas as notas continuam no armazenamento anterior.','info',true);
          return false;
        }
        reportActivation('A copiar as notas para o Dropbox. Não feche a aplicação durante a primeira transferência.','progress',true);
        const preview=await primary.reconcile();
        renderConflicts(preview.conflicts);
        if(preview.conflicts.length) {
          reportActivation('Ativação bloqueada: surgiram '+preview.conflicts.length+
            ' divergência(s) durante a transferência. Nenhuma versão divergente foi substituída.','warning',true);
          return false;
        }
        const result=await primary.enable();
        if(!primary.enabled())throw new Error('O modo principal não foi confirmado pelo navegador.');
        reportActivation('Dropbox principal ativado. '+result.pushed+
          ' nota(s) enviadas nesta etapa; nenhuma nota local apagada.','success',true);
        requestSync?.();
        return true;
      } catch(err) {
        const message='Ativação não concluída: '+db.userMessage(err);
        reportActivation(message,'error',true);
        say(message);
        return false;
      } finally {
        activationBusy=false;
        updateMode(modeStatus.textContent);
      }
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
        const remote = client();
        // A explicit action may create a missing destination folder, without
        // changing another note or replacing an existing remote file.
        if (explicit) {
          say('A verificar a pasta de destino no Dropbox…');
          await remote.ensureFolder(folder);
        }
        const result = await remote.upload(path, raw, revision);
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
      if (primary.enabled()) { requestSync?.(); return; }
      if (getCurrentOwner() !== owner || !readMap()[id]) return;
      if (pending.has(id)) clearTimeout(pending.get(id));
      if (!oauth?.connected()) return;
      const timer = setTimeout(() => {
        pending.delete(id);
        backup(id, false).catch(err => {
          if (selectedId === id) say('Dropbox pendente: ' + db.userMessage(err));
        });
      }, 2000);
      pending.set(id, timer);
    }
    function retryMapped() {
      if (primary.enabled()) { if(oauth?.connected())requestSync?.(); return; }
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
      const map = id && (primary.enabled() ? primary.readMap()[id] : readMap()[id]);
      if (map?.folder) folderInput.value = map.folder;
      else if (map?.path) folderInput.value = map.path.slice(0, map.path.lastIndexOf('/'));
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
    function disconnect() {
      oauth?.disconnect();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();waiting.clear();
      say('Dropbox desligado. As notas permanecem guardadas neste dispositivo; a sincronização Dropbox está suspensa.');
      updateMode();
    }
    async function resume() {
      if (!new URLSearchParams(root.location.search).has('code')) {
        if (!keyInput.value.trim()) return false;
        const auth = makeAuth();
        const restored = await auth.restorePersistent();
        if (restored) {
          say('Dropbox ligado neste dispositivo');
          retryMapped();
          requestSync?.();
        }
        return false;
      }
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
      const localIdByPath = new Map(Object.entries(readMap()).filter(([, item]) => item?.path)
        .map(([id, item]) => [String(item.path).toLocaleLowerCase(), id]));
      for (const entry of items.filter(item => item['.tag'] === 'file' && /\.keepnote\.json$/i.test(item.name))) {
        const match = /--([a-zA-Z0-9_-]+)\.keepnote\.json$/i.exec(entry.name);
        if (!match) continue;
        const note = getNote(localIdByPath.get(String(entry.path_display || '').toLocaleLowerCase()) || match[1]);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = (note ? 'Abrir nota: ' : 'Nota remota: ') + entry.name.replace(/--[a-zA-Z0-9_-]+\.keepnote\.json$/i, '');
        if (note) {
          button.addEventListener('click', () => { close(); openNote(note.id); });
        } else {
          button.textContent = 'Importar nota: ' + entry.name.replace(/--[a-zA-Z0-9_-]+\.keepnote\.json$/i, '');
          button.title = 'Importa sem substituir nenhuma nota existente; depois poderá abri-la';
          let imported = false;
          button.addEventListener('click', async () => {
            if (imported) return;
            if (getCurrentOwner() !== owner || !root.NOTAS_PRIVATE?.authorized) {
              say('A conta autorizada foi alterada; inicie novamente a sessão');
              return;
            }
            button.disabled = true;
            try {
              if (typeof importNote !== 'function') throw new Error('Importação indisponível nesta versão');
              if (!entry.rev || !entry.path_display) throw new Error('Metadados Dropbox incompletos');
              const remote = db.importableNote(await client().download(entry.path_display), owner, entry.name);
              if (getCurrentOwner() !== owner || !root.NOTAS_PRIVATE?.authorized) {
                throw new Error('A sessão mudou durante a transferência; nenhuma nota foi importada');
              }
              importNote(remote);
              imported = true;
              const mapping = readMap();
              mapping[remote.id] = {
                path: entry.path_display,
                folder: folder,
                rev: entry.rev,
                syncedAt: remote.updatedAt,
                updated: new Date().toISOString()
              };
              try { saveMap(mapping); }
              catch (_) { say('Nota importada, mas não foi possível memorizar a pasta Dropbox.'); }
              button.textContent = 'Abrir nota: ' + (remote.title || 'Sem título');
              button.addEventListener('click', () => { close(); openNote(remote.id); });
              say('Nota importada sem substituir dados. Clique em «Abrir nota» para a visualizar.');
            } catch (err) {
              button.disabled = false;
              say(err?.message || 'Não foi possível importar a nota');
            } finally {
              if (imported) button.disabled = false;
            }
          });
        }
        list.append(button);
      }
      say('Pasta: ' + (folder || '/'));
    }
    async function createFolder() {
      const path = safeFolder();
      const result = await client().ensureFolder(path);
      say(result.created.length ? 'Pasta criada: ' + path : 'A pasta já existe: ' + path);
    }
    async function saveSelected() {
      const id = selectedId;
      if (!id) throw new Error('Abra primeiro uma nota');
      if (!ensureSaved(id)) throw new Error('Guarde a nota antes de enviar ao Dropbox');
      const note = currentNote();
      localStorage.setItem(folderKey, folderInput.value.trim());
      if (primary.enabled()) {
        if (!oauth?.connected()) throw new Error('Ligue primeiro o Dropbox');
        const moved = await primary.placeInFolder(note,safeFolder());
        say('Nota guardada em ' + moved.path + (moved.oldPath
          ? '. A cópia anterior permanece em ' + moved.oldPath + ' para recuperação.'
          : ''));
        requestSync?.();
      } else await backup(id, true);
    }
    async function recoverSelected() {
      const note = currentNote();
      const map = primary.enabled() ? primary.readMap()[note.id] : readMap()[note.id];
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
      ['dropbox-disconnect',disconnect],
      ['dropbox-browse',listFolders],
      ['dropbox-create-folder',createFolder],
      ['dropbox-save',saveSelected],
      ['dropbox-recover',recoverSelected],
      ['dropbox-copy-link',copyLink],
      ['dropbox-inspect-conflicts',inspectBeforeActivation],
      ['dropbox-enable-primary',enablePrimary],
      ['dropbox-sync-all',syncPrimary]
    ];
    for (const [id, action] of events) $(id).addEventListener('click', () => {
      Promise.resolve().then(action).catch(err => {
        const message=db.userMessage(err);
        say(message);
        if(id==='dropbox-enable-primary' || id==='dropbox-inspect-conflicts')
          reportActivation('Operação não concluída: '+message,'error',true);
      });
    });
    root.addEventListener('online', retryMapped);
    let lastForegroundSync=0;
    function refreshOnReturn() {
      if (!primary.enabled() || !oauth?.connected() || getCurrentOwner()!==owner ||
          !root.NOTAS_PRIVATE?.authorized || document.visibilityState!=='visible') return;
      if (Date.now()-lastForegroundSync<15000) return;
      lastForegroundSync=Date.now();
      requestSync?.();
    }
    if (root.document?.defaultView===root) {
      root.addEventListener('focus',refreshOnReturn);
      document.addEventListener('visibilitychange',refreshOnReturn);
      root.setInterval(refreshOnReturn,60000);
    }
    root.addEventListener('notas:private-locked', () => {
      oauth?.disconnect();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      waiting.clear();
    });
    if (oauth?.connected()) setTimeout(retryMapped, 0);
    return Object.freeze({open, queue, resume, retryMapped, syncPrimary,
      primaryEnabled:()=>primary.enabled(),connected:() => !!oauth?.connected()});
  }
  const API = Object.freeze({create});
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.NotasDropboxUI = API;
})(globalThis);
