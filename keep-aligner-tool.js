/* Only builds copyable instructions. Never reads notes, auth or persistent data. */
((root) => {
  'use strict';
  const generator = 'C:/Users/ferna/Dropbox/1_KEEP ALIGNER PORTUGAL/FLUXO DE TRABALHO KEEP ALIGNER/GERADOR KEEP ALIGNER';
  const statusNames = {unknown: 'NÃO CONFIRMADO — verificar nas fontes; não presumir aprovação.', approved: 'APROVADO PELO DOUTOR.', review: 'EM REVISÃO — ainda não aprovado clinicamente.'};
  const kindNames = {unknown: 'Consultar nas fontes do caso.', new: 'NOVO.', modified: 'MODIFICADO.', refinement: 'REFINAMENTO.'};
  const clean = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
  function buildPrompt(mode, input) {
    if (!['guide', 'presentation'].includes(mode)) throw new Error('Escolha somente guia ou apresentação completa.');
    const data = Object.fromEntries(['reference', 'planning', 'status', 'kind', 'version', 'notes'].map(key => [key, clean(input?.[key])]));
    if (!data.reference) throw new Error('Indique a referência ou o link da ficha do caso.');
    if (data.reference.length > 2000 || data.planning.length > 6000 || data.version.length > 160 || data.notes.length > 2000) throw new Error('Há um campo demasiado longo. Reduza-o antes de copiar.');
    if (data.planning) {
      let url;
      try { url = new URL(data.planning); } catch { throw new Error('O link 3D deve ser um endereço completo, começando por https:// ou http://.'); }
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('O link 3D deve começar por https:// ou http://.');
    }
    const lines = [
      'Use o Remote Desktop Commander no MSI.',
      'Leia este manual e siga o procedimento do agente, sem consultar a conversa antiga:',
      `${generator}/MANUAL RAPIDO.md`, '',
      mode === 'guide' ? 'Tarefa: SOMENTE GUIA DE TRATAMENTO KEEP ALIGNER.' : 'Tarefa: APRESENTAÇÃO COMPLETA DO PLANO DE TRATAMENTO KEEP ALIGNER.',
      `Caso: ${data.reference}`,
      `Plano / animação 3D: ${data.planning || 'Consultar a versão correta na ficha do caso.'}`,
      `Versão: ${data.version || 'Confirmar a versão atual indicada na ficha; não misturar versões.'}`,
      `Estado clínico informado: ${statusNames[data.status] || statusNames.unknown}`,
      `Tipo de tratamento: ${kindNames[data.kind] || kindNames.unknown}`, '',
      'Consulte o modelo oficial editável e as duas páginas de referência indicadas no manual. Preserve o padrão KEEP ALIGNER; os dados do exemplo não são prescrição para este paciente.',
      'Use as skills correspondentes e o motor instalado. Reutilize a ficha e o trabalho da mesma versão, recolhendo apenas o que faltar ou mudar. Valide os dados e inspecione as prévias reais antes de entregar. Não altere guias já entregues.'
    ];
    if (mode === 'guide') {
      lines.push('Crie somente a guia editável, com odontograma e relatório clínico na segunda página. Mostre a prévia e guarde a definitiva em INFORME quando aplicável. Se o plano estiver pendente, mantenha-a como rascunho, não como guia de execução. Não crie apresentação completa nem publique em My Keep.');
    } else {
      lines.push('Prepare a guia padrão editável, antes/depois 4K com capturas reais e contactos oclusais desligados, tabela original de movimentos recortada, fontes CSV e texto de apresentação. Confira a identidade, versão, contagens, auxiliares, texto e preço aplicável + IVA.',
        'Mostre o pacote completo para minha conferência. Não faça uploads, mensagens, Salvar Alterações, publicação ou alterações de estado em My Keep sem a minha autorização específica para este pacote, paciente e versão. Não confunda autorização de publicação com aprovação clínica.');
    }
    if (data.notes) lines.push('', 'Informação adicional fornecida para este caso:', data.notes);
    return lines.join('\n');
  }
  if (typeof module === 'object' && module.exports) module.exports = {buildPrompt};
  if (!root.document) return;
  const doc = root.document, dialog = doc.getElementById('keep-aligner-dialog'), opener = doc.getElementById('keep-aligner-tool-btn');
  if (!dialog || !opener) return;
  const form = doc.getElementById('keep-aligner-form'), status = doc.getElementById('ka-copy-status'), output = doc.getElementById('ka-output'), result = doc.getElementById('ka-result');
  let copying = false, revision = 0;
  const buttons = ['ka-copy-guide', 'ka-copy-presentation'].map(id => doc.getElementById(id));
  const buttonLabels = buttons.map(button => button.textContent);
  const resetButtonLabels = () => buttons.forEach((button, index) => { button.textContent = buttonLabels[index]; });
  const shell = doc.getElementById('private-app');
  const unlocked = () => !!shell && !shell.hidden && !shell.inert && !doc.body.classList.contains('private-locked');
  const clearPrivateFields = () => {
    revision++;
    if (dialog.open) dialog.close();
    form.reset();
    output.value = '';
    result.hidden = true;
    resetButtonLabels();
    status.dataset.state = '';
    status.textContent = 'Preencha a referência do caso e escolha um dos pedidos.';
  };
  const observer = new root.MutationObserver(() => { if (!unlocked()) clearPrivateFields(); });
  observer.observe(shell, {attributes: true, attributeFilter: ['hidden', 'inert']});
  observer.observe(doc.body, {attributes: true, attributeFilter: ['class']});
  opener.addEventListener('click', () => {
    if (!unlocked()) return;
    if (!dialog.open) dialog.showModal();
    doc.getElementById('ka-reference').focus();
  });
  doc.getElementById('keep-aligner-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => opener.focus());
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', () => {
    revision++;
    result.hidden = true;
    output.value = '';
    resetButtonLabels();
    status.dataset.state = '';
    status.textContent = 'Dados alterados. Escolha novamente o pedido para copiar a versão atual.';
  });
  function selectForManualCopy() {
    output.focus();
    output.select();
    output.setSelectionRange(0, output.value.length);
  }
  async function copy(mode) {
    if (copying || !unlocked()) return;
    if (!form.reportValidity()) return;
    let prompt;
    try {
      prompt = buildPrompt(mode, Object.fromEntries(new FormData(form)));
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message;
      return;
    }
    copying = true;
    const copiedRevision = revision;
    resetButtonLabels();
    buttons.forEach(button => { button.disabled = true; });
    output.value = prompt;
    result.hidden = false;
    status.textContent = 'A copiar…';
    let copied = false;
    try {
      if (!root.navigator?.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await root.navigator.clipboard.writeText(prompt);
      copied = true;
    } catch {
      if (unlocked() && copiedRevision === revision) {
        selectForManualCopy();
        try { copied = doc.execCommand('copy'); } catch { /* Manual selection remains available. */ }
      }
    } finally {
      copying = false;
      buttons.forEach(button => { button.disabled = false; });
    }
    if (!unlocked() || copiedRevision !== revision) return;
    if (copied) buttons[mode === 'guide' ? 0 : 1].textContent = `✓ Copiado — ${mode === 'guide' ? 'somente guia' : 'apresentação completa'}`;
    status.dataset.state = copied ? 'success' : 'manual';
    status.textContent = copied
      ? `Pedido de ${mode === 'guide' ? 'somente guia' : 'apresentação completa'} copiado. Cole-o no agente ligado ao MSI.`
      : 'O navegador bloqueou a cópia. O pedido está selecionado abaixo: use Copiar no teclado ou no menu do telemóvel.';
  }
  buttons[0].addEventListener('click', () => copy('guide'));
  buttons[1].addEventListener('click', () => copy('presentation'));
})(typeof window === 'object' ? window : globalThis);
