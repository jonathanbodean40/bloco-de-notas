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
  const config = window.NOTAS_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/.test(config.supabaseUrl || '') && /^(sb_publishable_|eyJ)/.test(config.supabasePublishableKey || '');
  const cloud = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
  let user = null;
  let notes = loadNotes(GUEST_KEY);
  let currentId = null;
  let savedRange = null;
  let saveTimer = null;

  function storageKey() { return user ? `${GUEST_KEY}:${user.id}` : GUEST_KEY; }
  function loadNotes(key = storageKey()) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  }

  function persist() { localStorage.setItem(storageKey(), JSON.stringify(notes)); }
  function plainText(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return (el.textContent || '').trim();
  }
  function makeId() { return self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }

  function saveNote(showMessage = true) {
    const heading = title.textContent.trim();
    const html = editor.innerHTML;
    if (!heading && !plainText(html)) return;
    const now = new Date().toISOString();
    const note = { id: currentId || makeId(), title: heading || 'Sem título', content: html, updatedAt: now };
    const index = notes.findIndex(item => item.id === note.id);
    if (index >= 0) notes[index] = note; else notes.unshift(note);
    currentId = note.id;
    notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    persist();
    if (user) pushNote(note);
    renderNotes();
    deleteBtn.hidden = false;
    if (showMessage) showSaved();
  }

  async function pushNote(note) {
    const { error } = await cloud.from('notes').upsert({ id: note.id, user_id: user.id, title: note.title, content: note.content, updated_at: note.updatedAt });
    if (error) { saveStatus.textContent = 'Guardado neste dispositivo; sincronização pendente'; return; }
    saveStatus.textContent = 'Sincronizado';
  }

  async function syncNotes() {
    if (!cloud || !user) return;
    saveStatus.textContent = 'A sincronizar…';
    const guestNotes = loadNotes(GUEST_KEY);
    const localNotes = loadNotes(storageKey());
    const combined = [...localNotes, ...guestNotes].reduce((map, note) => {
      const previous = map.get(note.id);
      if (!previous || new Date(note.updatedAt) > new Date(previous.updatedAt)) map.set(note.id, note);
      return map;
    }, new Map());
    const upload = [...combined.values()].map(note => ({ id: note.id, user_id: user.id, title: note.title, content: note.content, updated_at: note.updatedAt }));
    if (upload.length) {
      const { error } = await cloud.from('notes').upsert(upload);
      if (error) { saveStatus.textContent = 'Sem ligação; notas guardadas neste dispositivo'; return; }
    }
    const { data, error } = await cloud.from('notes').select('id,title,content,updated_at').order('updated_at', { ascending: false });
    if (error) { saveStatus.textContent = 'Não foi possível sincronizar'; return; }
    notes = data.map(note => ({ id: note.id, title: note.title, content: note.content, updatedAt: note.updated_at }));
    persist();
    localStorage.removeItem(GUEST_KEY);
    renderNotes();
    saveStatus.textContent = 'Sincronizado';
  }

  function showSaved() {
    saveStatus.textContent = 'Guardado';
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveStatus.textContent = ''; }, 1600);
  }

  function newNote() {
    currentId = null;
    title.textContent = '';
    editor.innerHTML = '';
    deleteBtn.hidden = true;
    closeSidebar();
    title.focus();
    renderNotes();
  }

  function openNote(id) {
    const note = notes.find(item => item.id === id);
    if (!note) return;
    currentId = note.id;
    title.textContent = note.title === 'Sem título' ? '' : note.title;
    editor.innerHTML = note.content || '';
    deleteBtn.hidden = false;
    closeSidebar();
    renderNotes();
    editor.focus();
  }

  async function deleteNote() {
    if (!currentId || !confirm('Eliminar esta nota?')) return;
    notes = notes.filter(item => item.id !== currentId);
    persist();
    if (user) await cloud.from('notes').delete().eq('id', currentId);
    newNote();
  }

  function setAuthView() {
    signedOutActions.hidden = Boolean(user);
    signedInActions.hidden = !user;
    authEmail.closest('label').hidden = Boolean(user);
    authPassword.closest('label').hidden = Boolean(user);
    accountBtn.classList.toggle('synced', Boolean(user));
    accountBtn.title = user ? `Sincronizado: ${user.email}` : 'Conta e sincronização';
    authMessage.textContent = user ? `Sessão iniciada como ${user.email}` : (configured ? '' : 'Primeiro configure o ficheiro config.js.');
  }

  async function signIn(event) {
    event.preventDefault();
    if (!cloud) return setAuthView();
    authMessage.textContent = 'A entrar…';
    const { error } = await cloud.auth.signInWithPassword({ email: authEmail.value.trim(), password: authPassword.value });
    authMessage.textContent = error ? error.message : 'Sessão iniciada.';
  }

  async function signUp() {
    if (!authForm.reportValidity() || !cloud) return;
    authMessage.textContent = 'A criar a conta…';
    const { error } = await cloud.auth.signUp({ email: authEmail.value.trim(), password: authPassword.value, options: { emailRedirectTo: location.origin + location.pathname } });
    authMessage.textContent = error ? error.message : 'Conta criada. Confirme o e-mail recebido e depois entre.';
  }

  async function signOut() {
    await cloud.auth.signOut();
    currentId = null;
    notes = loadNotes(GUEST_KEY);
    newNote();
    authDialog.close();
  }

  function renderNotes() {
    notesList.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-list';
      empty.textContent = 'Ainda não existem notas guardadas.';
      notesList.append(empty);
      return;
    }
    notes.forEach(note => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `sidebar-note-item${note.id === currentId ? ' active' : ''}`;
      const heading = document.createElement('strong');
      const preview = document.createElement('small');
      heading.textContent = note.title || 'Sem título';
      preview.textContent = plainText(note.content) || 'Nota vazia';
      button.append(heading, preview);
      button.addEventListener('click', () => openNote(note.id));
      notesList.append(button);
    });
  }

  function openSidebar() {
    sidebar.classList.add('active');
    sidebar.setAttribute('aria-hidden', 'false');
    backdrop.hidden = false;
  }
  function closeSidebar() {
    sidebar.classList.remove('active');
    sidebar.setAttribute('aria-hidden', 'true');
    backdrop.hidden = true;
  }

  function rememberSelection() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode)) savedRange = selection.getRangeAt(0).cloneRange();
  }
  function restoreSelection() {
    editor.focus();
    if (!savedRange) return;
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }
  function runCommand(command, value = null) {
    restoreSelection();
    document.execCommand(command, false, value);
    rememberSelection();
    closeMenu();
    editor.dispatchEvent(new Event('input'));
  }

  function openMenu(event) {
    event.preventDefault();
    rememberSelection();
    menu.classList.add('open');
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(10, Math.min(event.clientX, innerWidth - rect.width - 10))}px`;
    menu.style.top = `${Math.max(10, Math.min(event.clientY, innerHeight - rect.height - 10))}px`;
  }
  function closeMenu() { menu.classList.remove('open'); }

  document.querySelector('#toggle-sidebar-btn').addEventListener('click', openSidebar);
  document.querySelector('#close-sidebar-btn').addEventListener('click', closeSidebar);
  document.querySelector('#new-note-btn').addEventListener('click', newNote);
  document.querySelector('#save-btn').addEventListener('click', () => saveNote(true));
  deleteBtn.addEventListener('click', deleteNote);
  accountBtn.addEventListener('click', () => { setAuthView(); authDialog.showModal(); });
  document.querySelector('#close-auth-btn').addEventListener('click', () => authDialog.close());
  document.querySelector('#signup-btn').addEventListener('click', signUp);
  document.querySelector('#logout-btn').addEventListener('click', signOut);
  document.querySelector('#sync-btn').addEventListener('click', syncNotes);
  authForm.addEventListener('submit', signIn);
  backdrop.addEventListener('click', closeSidebar);
  editor.addEventListener('contextmenu', openMenu);
  editor.addEventListener('mouseup', rememberSelection);
  editor.addEventListener('keyup', rememberSelection);

  menu.addEventListener('mousedown', event => event.preventDefault());
  menu.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.command) runCommand(button.dataset.command);
    if (button.dataset.size) runCommand('fontSize', button.dataset.size);
    if (button.dataset.color) runCommand('foreColor', button.dataset.color);
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeMenu(); closeSidebar(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNote(true); }
  });

  let autoSave;
  [title, editor].forEach(element => element.addEventListener('input', () => {
    saveStatus.textContent = 'A editar…';
    window.clearTimeout(autoSave);
    autoSave = window.setTimeout(() => saveNote(false), 900);
  }));

  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
  if (cloud) {
    cloud.auth.getSession().then(({ data }) => {
      user = data.session?.user || null;
      setAuthView();
      if (user) syncNotes();
    });
    cloud.auth.onAuthStateChange((_event, session) => {
      const changed = session?.user?.id !== user?.id;
      user = session?.user || null;
      setAuthView();
      if (user && changed) syncNotes();
    });
    window.addEventListener('focus', () => { if (user) syncNotes(); });
  } else setAuthView();
  renderNotes();
  title.focus();
})();
