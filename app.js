(() => {
  'use strict';
  const GUEST_KEY = 'notas-exclusivas-pro-v2';
  const title = document.querySelector('#note-title');
  const editor = document.querySelector('#note-text');
  const sidebar = document.querySelector('#sidebar');
  const notesList = document.querySelector('#sidebar-notes-list');
  const backdrop = document.querySelector('#sidebar-backdrop');
  const menu = document.querySelector('#custom-context-menu');
  const saveStatus = document.querySelector('#save-status');
  const deleteBtn = document.querySelector('#delete-btn');
  const accountBtn = document.querySelector('#account-btn');
  const authDialog = document.querySelector('#auth-dialog');
  const authForm = document.querySelector('#auth-form');
  const authEmail = document.querySelector('#auth-email');
  const authPassword = document.querySelector('#auth-password');
  const authMessage = document.querySelector('#auth-message');
  const signedOutActions = document.querySelector('#signed-out-actions');
  const signedInActions = document.querySelector('#signed-in-actions');
  const fontSizeInput = document.querySelector('#font-size-input');
  const config = window.NOTAS_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');
  const cloud = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let user = null;
  let notes = loadNotes(GUEST_KEY);
  let currentId = null;
  let savedRange = null;
  let activeEditable = editor;
  let saveTimer = null;
  let autoSave = null;
  let titleHtmlSupported = true;

  function storageKey() { return user ? `${GUEST_KEY}:${user.id}` : GUEST_KEY; }
  function loadNotes(key = storageKey()) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
  function persist() { localStorage.setItem(storageKey(), JSON.stringify(notes)); }
  function plainText(html) { const el = document.createElement('div'); el.innerHTML = html || ''; return (el.textContent || '').trim(); }
  function makeId() { return self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
  function isMissingTitleHtml(error) { return /title_html/i.test(error?.message || ''); }
  function noteRow(note) {
    const row = { id: note.id, user_id: user.id, title: note.title, content: note.content, updated_at: note.updatedAt, deleted_at: note.deletedAt || null };
    if (titleHtmlSupported) row.title_html = note.titleHtml || '';
    return row;
  }

  async function saveNote(showMessage = true) {
    const titleHtml = title.innerHTML;
    const heading = plainText(titleHtml);
    const html = editor.innerHTML;
    if (!heading && !plainText(html)) return false;
    const now = new Date().toISOString();
    const note = { id: currentId || makeId(), title: heading || 'Sem título', titleHtml, content: html, updatedAt: now, deletedAt: null };
    const index = notes.findIndex(item => item.id === note.id);
    if (index >= 0) notes[index] = note; else notes.unshift(note);
    currentId = note.id;
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    persist(); renderNotes(); deleteBtn.hidden = false;
    if (user) await pushNote(note);
    if (showMessage && !user) showSaved();
    return true;
  }

  async function pushNote(note) {
    let { error } = await cloud.from('notes').upsert(noteRow(note));
    if (error && titleHtmlSupported && isMissingTitleHtml(error)) {
      titleHtmlSupported = false;
      ({ error } = await cloud.from('notes').upsert(noteRow(note)));
    }
    saveStatus.textContent = error ? 'Guardado neste dispositivo; sincronização pendente' : 'Sincronizado';
    return !error;
  }

  async function fetchRemote() {
    let fields = 'id,title,title_html,content,updated_at,deleted_at';
    let result = await cloud.from('notes').select(fields).order('updated_at', { ascending: false });
    if (result.error && isMissingTitleHtml(result.error)) {
      titleHtmlSupported = false;
      result = await cloud.from('notes').select('id,title,content,updated_at,deleted_at').order('updated_at', { ascending: false });
    }
    return result;
  }

  async function syncNotes() {
    if (!cloud || !user) return;
    saveStatus.textContent = 'A sincronizar…';
    const localCombined = [...loadNotes(storageKey()), ...loadNotes(GUEST_KEY)].reduce((map, note) => {
      const previous = map.get(note.id);
      if (!previous || new Date(note.updatedAt) > new Date(previous.updatedAt)) map.set(note.id, note);
      return map;
    }, new Map());
    const { data: remoteData, error: downloadError } = await fetchRemote();
    if (downloadError) { saveStatus.textContent = 'Sem ligação; notas guardadas neste dispositivo'; return; }
    const remote = remoteData.map(note => ({ id: note.id, title: note.title, titleHtml: note.title_html || '', content: note.content, updatedAt: note.updated_at, deletedAt: note.deleted_at || null }));
    const remoteById = new Map(remote.map(note => [note.id, note]));
    const pending = [...localCombined.values()].filter(note => !remoteById.has(note.id) || new Date(note.updatedAt) > new Date(remoteById.get(note.id).updatedAt));
    if (pending.length) {
      let { error } = await cloud.from('notes').upsert(pending.map(noteRow));
      if (error && titleHtmlSupported && isMissingTitleHtml(error)) {
        titleHtmlSupported = false;
        ({ error } = await cloud.from('notes').upsert(pending.map(noteRow)));
      }
      if (error) { saveStatus.textContent = 'Sem ligação; notas guardadas neste dispositivo'; return; }
    }
    const merged = new Map(remote.map(note => [note.id, note])); pending.forEach(note => merged.set(note.id, note));
    notes = [...merged.values()].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    persist(); localStorage.removeItem(GUEST_KEY); renderNotes(); saveStatus.textContent = 'Sincronizado';
  }

  function showSaved() { saveStatus.textContent = 'Guardado neste dispositivo'; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveStatus.textContent = ''; }, 1800); }
  function clearEditor(focus = true) { currentId = null; title.innerHTML = ''; editor.innerHTML = ''; deleteBtn.hidden = true; renderNotes(); if (focus) title.focus(); }
  function newNote() { clearEditor(true); closeSidebar(); }
  async function closeCurrentNote() { await saveNote(false); clearEditor(false); closeMenu(); }
  function openNote(id) {
    const note = notes.find(item => item.id === id && !item.deletedAt); if (!note) return;
    currentId = note.id;
    title.innerHTML = note.titleHtml || (note.title === 'Sem título' ? '' : escapeHtml(note.title));
    editor.innerHTML = note.content || '';
    deleteBtn.hidden = false; closeSidebar(); renderNotes(); editor.focus();
  }
  function escapeHtml(value) { const div = document.createElement('div'); div.textContent = value || ''; return div.innerHTML; }

  async function deleteNoteById(id, closeAfter = false) {
    const existing = notes.find(item => item.id === id && !item.deletedAt); if (!existing || !confirm(`Eliminar a nota “${existing.title || 'Sem título'}”?`)) return;
    const deletedAt = new Date().toISOString(); const tombstone = { ...existing, updatedAt: deletedAt, deletedAt };
    notes = notes.map(item => item.id === id ? tombstone : item); persist();
    if (user) await pushNote(tombstone);
    if (currentId === id) clearEditor(false);
    renderNotes(); if (closeAfter) closeSidebar();
  }

  function renderNotes() {
    notesList.replaceChildren(); const visibleNotes = notes.filter(note => !note.deletedAt);
    if (!visibleNotes.length) { const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = 'Ainda não existem notas guardadas.'; notesList.append(empty); return; }
    visibleNotes.forEach(note => {
      const item = document.createElement('div'); item.className = `sidebar-note-item${note.id === currentId ? ' active' : ''}`;
      const open = document.createElement('button'); open.type = 'button'; open.className = 'sidebar-note-open'; open.setAttribute('aria-label', `Abrir ${note.title || 'nota'}`);
      const heading = document.createElement('strong'); const preview = document.createElement('small');
      heading.textContent = note.title || 'Sem título'; preview.textContent = plainText(note.content) || 'Nota vazia'; open.append(heading, preview); open.addEventListener('click', () => openNote(note.id));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'sidebar-delete-btn'; remove.textContent = '✕'; remove.title = 'Eliminar nota'; remove.setAttribute('aria-label', `Eliminar ${note.title || 'nota'}`); remove.addEventListener('click', () => deleteNoteById(note.id));
      item.append(open, remove); notesList.append(item);
    });
  }

  function openSidebar() { sidebar.classList.add('active'); sidebar.setAttribute('aria-hidden', 'false'); backdrop.hidden = false; }
  function closeSidebar() { sidebar.classList.remove('active'); sidebar.setAttribute('aria-hidden', 'true'); backdrop.hidden = true; }
  function setAuthView() {
    signedOutActions.hidden = Boolean(user); signedInActions.hidden = !user; authEmail.closest('label').hidden = Boolean(user); authPassword.closest('label').hidden = Boolean(user);
    accountBtn.classList.toggle('synced', Boolean(user)); accountBtn.title = user ? `Sincronizado: ${user.email}` : 'Conta e sincronização';
    authMessage.textContent = user ? `Sessão iniciada como ${user.email}` : (configured ? '' : 'Primeiro configure o ficheiro config.js.');
  }
  async function signIn(event) { event.preventDefault(); if (!cloud) return setAuthView(); authMessage.textContent = 'A entrar…'; const { error } = await cloud.auth.signInWithPassword({ email: authEmail.value.trim(), password: authPassword.value }); authMessage.textContent = error ? error.message : 'Sessão iniciada.'; }
  async function signUp() { if (!authForm.reportValidity() || !cloud) return; authMessage.textContent = 'A criar a conta…'; const { error } = await cloud.auth.signUp({ email: authEmail.value.trim(), password: authPassword.value, options: { emailRedirectTo: location.origin + location.pathname } }); authMessage.textContent = error ? error.message : 'Conta criada. Confirme o e-mail recebido e depois entre.'; }
  async function signOut() { await cloud.auth.signOut(); user = null; notes = loadNotes(GUEST_KEY); clearEditor(false); authDialog.close(); }

  function rememberSelection(editable = null) {
    const selection = window.getSelection(); const candidate = editable || (title.contains(selection?.anchorNode) ? title : editor.contains(selection?.anchorNode) ? editor : null);
    if (candidate && selection?.rangeCount) { activeEditable = candidate; savedRange = selection.getRangeAt(0).cloneRange(); }
  }
  function restoreSelection() { activeEditable.focus(); if (!savedRange) return; const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange); }
  function dispatchEdit() { activeEditable.dispatchEvent(new Event('input', { bubbles: true })); rememberSelection(activeEditable); }
  function runCommand(command, value = null, close = true) { restoreSelection(); document.execCommand(command, false, value); dispatchEdit(); if (close) closeMenu(); }
  function applyFontSize(px) {
    const value = Math.min(96, Math.max(8, Number(px) || 18)); fontSizeInput.value = value; restoreSelection(); document.execCommand('fontSize', false, '7');
    activeEditable.querySelectorAll('font[size="7"]').forEach(font => { const span = document.createElement('span'); span.style.fontSize = `${value}px`; while (font.firstChild) span.append(font.firstChild); font.replaceWith(span); });
    dispatchEdit(); closeMenu();
  }
  function changeCase(mode) { restoreSelection(); const selection = window.getSelection(); const text = selection.toString(); if (!text) return; const changed = mode === 'upper' ? text.toLocaleUpperCase('pt-PT') : text.toLocaleLowerCase('pt-PT'); document.execCommand('insertText', false, changed); dispatchEdit(); closeMenu(); }
  function applyHighlight(color) { runCommand('hiliteColor', color); }
  function openMenu(event) {
    event.preventDefault(); activeEditable = event.currentTarget; rememberSelection(activeEditable); menu.classList.add('open');
    const rect = menu.getBoundingClientRect(); menu.style.left = `${Math.max(6, Math.min(event.clientX, innerWidth - rect.width - 6))}px`; menu.style.top = `${Math.max(6, Math.min(event.clientY, innerHeight - rect.height - 6))}px`;
  }
  function closeMenu() { menu.classList.remove('open'); }

  document.querySelector('#toggle-sidebar-btn').addEventListener('click', openSidebar); document.querySelector('#close-sidebar-btn').addEventListener('click', closeSidebar);
  document.querySelector('#new-note-btn').addEventListener('click', newNote); document.querySelector('#close-note-btn').addEventListener('click', closeCurrentNote);
  document.querySelector('#save-btn').addEventListener('click', () => saveNote(true)); deleteBtn.addEventListener('click', () => currentId && deleteNoteById(currentId));
  document.querySelector('#undo-btn').addEventListener('click', () => runCommand('undo', null, false)); document.querySelector('#redo-btn').addEventListener('click', () => runCommand('redo', null, false));
  accountBtn.addEventListener('click', () => { setAuthView(); authDialog.showModal(); }); document.querySelector('#close-auth-btn').addEventListener('click', () => authDialog.close());
  document.querySelector('#signup-btn').addEventListener('click', signUp); document.querySelector('#logout-btn').addEventListener('click', signOut); document.querySelector('#sync-btn').addEventListener('click', syncNotes); authForm.addEventListener('submit', signIn); backdrop.addEventListener('click', closeSidebar);
  [title, editor].forEach(element => { element.addEventListener('contextmenu', openMenu); element.addEventListener('mouseup', () => rememberSelection(element)); element.addEventListener('keyup', () => rememberSelection(element)); element.addEventListener('focus', () => { activeEditable = element; }); element.addEventListener('input', () => { saveStatus.textContent = 'A editar…'; clearTimeout(autoSave); autoSave = setTimeout(() => saveNote(false), 900); }); });

  menu.addEventListener('pointerdown', event => { if (event.target.closest('button')) event.preventDefault(); });
  menu.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.command) runCommand(button.dataset.command);
    else if (button.dataset.case) changeCase(button.dataset.case);
    else if (button.dataset.fontPx) applyFontSize(button.dataset.fontPx);
    else if (button.dataset.color) runCommand('foreColor', button.dataset.color);
    else if (button.dataset.highlight) applyHighlight(button.dataset.highlight);
    else if (button.dataset.sizeStep) fontSizeInput.value = Math.min(96, Math.max(8, Number(fontSizeInput.value) + Number(button.dataset.sizeStep)));
  });
  document.querySelector('#apply-size-btn').addEventListener('click', () => applyFontSize(fontSizeInput.value));
  document.querySelector('#text-color-input').addEventListener('change', event => runCommand('foreColor', event.target.value));
  document.querySelector('#highlight-color-input').addEventListener('change', event => applyHighlight(event.target.value));
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(); closeSidebar(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNote(true); } });

  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
  if (cloud) {
    cloud.auth.getSession().then(({ data }) => { user = data.session?.user || null; setAuthView(); if (user) syncNotes(); });
    cloud.auth.onAuthStateChange((_event, session) => { const changed = session?.user?.id !== user?.id; user = session?.user || null; setAuthView(); if (user && changed) syncNotes(); });
    addEventListener('focus', () => { if (user) syncNotes(); });
  } else setAuthView();
  renderNotes(); title.focus();
})();
