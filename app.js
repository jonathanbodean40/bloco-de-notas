(() => {
  'use strict';

  const STORAGE_KEY = 'notas-exclusivas-pro-v2';
  const title = document.querySelector('#note-title');
  const editor = document.querySelector('#note-text');
  const sidebar = document.querySelector('#sidebar');
  const notesList = document.querySelector('#sidebar-notes-list');
  const backdrop = document.querySelector('#sidebar-backdrop');
  const menu = document.querySelector('#custom-context-menu');
  const saveStatus = document.querySelector('#save-status');
  const deleteBtn = document.querySelector('#delete-btn');
  let notes = loadNotes();
  let currentId = null;
  let savedRange = null;
  let saveTimer = null;

  function loadNotes() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }

  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
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
    renderNotes();
    deleteBtn.hidden = false;
    if (showMessage) showSaved();
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

  function deleteNote() {
    if (!currentId || !confirm('Eliminar esta nota?')) return;
    notes = notes.filter(item => item.id !== currentId);
    persist();
    newNote();
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
  renderNotes();
  title.focus();
})();
