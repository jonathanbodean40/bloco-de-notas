// Development fixture only. Production index.html never loads this file.
(() => {
  const id = 'keep-tool-demo', key = `notas-exclusivas-pro-v2:${id}`;
  window.NOTAS_CONFIG = {preview: true};
  window.NOTAS_PRIVATE = {authorized: true, client: null, session: {user: {id, email: 'demonstracao@example.invalid'}}, validate: async () => true, signOut: async () => {}, manageDevices: () => {}};
  if (localStorage.getItem(key) === null) {
    localStorage.setItem(key, JSON.stringify([{id: 'keep-demo-note', title: 'NOTA FICTÍCIA — PRÉVIA LOCAL', content: '<p>Esta nota serve apenas para verificar que a ferramenta preserva o editor. Nenhum dado de paciente foi carregado.</p>', updatedAt: '2026-10-23T12:00:00.000Z'}]));
    localStorage.setItem(`${key}:primary`, 'keep-demo-note');
  }
  localStorage.setItem('notas-exclusivas-pro-v2:spelling-language', 'off');
  document.getElementById('private-access').hidden = true;
  document.getElementById('private-startup-status').hidden = true;
  const shell = document.getElementById('private-app'); shell.hidden = false; shell.inert = false;
  document.body.classList.remove('private-locked');
  document.querySelector('.brand').textContent = 'PRÉVIA LOCAL — NÃO PUBLICADA';
  const script = document.createElement('script'); script.src = 'app.js'; document.body.append(script);
  addEventListener('load', () => {
    if (new URLSearchParams(location.search).get('tool') === 'keep') document.getElementById('keep-aligner-tool-btn').click();
  });
})();
