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
      'Use o Keep Remote no MSI.',
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
  const activeLocalStates = new Set(['queued','validating_sources','generating','validating_outputs']);
  function localStatus(value = {}) {
    const state=String(value.state || 'unavailable');
    const pending=activeLocalStates.has(state);
    let message=String(value.message || (pending ? 'Pedido em processamento no MSI.' : 'Estado técnico: '+state+'.')).slice(0,300);
    if (value.progress && Number.isInteger(value.progress.step) && value.progress.step>=1 && value.progress.step<=3 && value.progress.total===3)
      message+=' Etapa '+value.progress.step+'/3.';
    if (state==='awaiting_visual_review' && Number.isInteger(value.artifactCount) && value.artifactCount>0 && value.artifactCount<=32)
      message+=' '+value.artifactCount+' ficheiros verificados. Revisão humana obrigatória.';
    return {pending,message,clinicalApproval:false,publishingAuthorized:false};
  }
  if (typeof module === 'object' && module.exports) module.exports = {buildPrompt,localStatus};
  if (!root.document) return;
  const doc = root.document, dialog = doc.getElementById('keep-aligner-dialog'), opener = doc.getElementById('keep-aligner-tool-btn');
  if (!dialog || !opener) return;
  const form = doc.getElementById('keep-aligner-form'), status = doc.getElementById('ka-copy-status'), output = doc.getElementById('ka-output'), result = doc.getElementById('ka-result');
  let copying = false, revision = 0;
  const buttons = ['ka-copy-guide', 'ka-copy-presentation'].map(id => doc.getElementById(id));
  const buttonLabels = buttons.map(button => button.textContent);
  // The last ticket lives only in memory, not in notes or persistent storage.
  let lastLocalTicket = null, localStatusButton = null;
  const resetButtonLabels = () => buttons.forEach((button, index) => { button.textContent = buttonLabels[index]; });
  const shell = doc.getElementById('private-app');
  const unlocked = () => !!shell && !shell.hidden && !shell.inert && !doc.body.classList.contains('private-locked');
  const clearPrivateFields = () => {
    revision++;
    lastLocalTicket = null;
    if (localStatusButton) localStatusButton.hidden = true;
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
    lastLocalTicket = null;
    if (localStatusButton) localStatusButton.hidden = true;
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
  // Windows-only local execution queue; Android retains the existing copy
  // workflow until a separate authenticated remote transport is installed.
  if (typeof root.NOTAS_DESKTOP?.queueKeepJob === 'function') {
    const actions=doc.querySelector('#keep-aligner-dialog .ka-copy-actions');
    if (typeof root.NOTAS_DESKTOP.keepJobStatus === 'function') {
      localStatusButton=doc.createElement('button');
      localStatusButton.type='button';
      localStatusButton.className='ka-local-status';
      localStatusButton.textContent='Consultar estado do último pedido';
      localStatusButton.hidden=true;
      actions.append(localStatusButton);
      localStatusButton.addEventListener('click',async()=>{
        if (!unlocked() || !lastLocalTicket || localStatusButton.disabled) return;
        const ticket=lastLocalTicket;
        localStatusButton.disabled=true;
        try {
          const current=await root.NOTAS_DESKTOP.keepJobStatus(ticket);
          if (ticket!==lastLocalTicket || !unlocked()) return;
          status.dataset.state=current.state==='blocked'?'error':'manual';
          status.textContent=localStatus(current).message;
        } catch {
          if (ticket===lastLocalTicket && unlocked()) {
            status.dataset.state='error';
            status.textContent='Não foi possível consultar o estado do pedido no MSI.';
          }
        } finally { localStatusButton.disabled=false; }
      });
    }
    for (const [mode, label] of [
      ['guide','Preparar guia no MSI'],
      ['presentation','Preparar apresentação no MSI']
    ]) {
      const btn=doc.createElement('button');
      btn.type='button';
      btn.className='ka-local-submit';
      btn.textContent=label;
      actions.append(btn);
      btn.addEventListener('click',async()=>{
        if(!unlocked() || !form.reportValidity() || copying || btn.disabled)return;
        btn.disabled=true;
        status.dataset.state='';
        status.textContent='A enviar pedido para o executor local do MSI…';
        try{
          const fields=Object.fromEntries(new FormData(form));
          // Reuse the strict prompt validator before crossing the IPC boundary.
          buildPrompt(mode,fields);
          const ticket=await root.NOTAS_DESKTOP.queueKeepJob({mode,...fields});
          if (!/^[a-f0-9]{32}$/.test(String(ticket?.id||''))) throw new Error('Identificador local inválido');
          lastLocalTicket=ticket.id;
          if(localStatusButton) localStatusButton.hidden=false;
          status.textContent='Pedido recebido no MSI. A verificar a ficha estruturada…';
          if(typeof root.NOTAS_DESKTOP.keepJobStatus === 'function'){
            let receivedResult=false;
            for(let retry=0;retry<8;retry++){
              await new Promise(resolve=>root.setTimeout(resolve,850));
              const state=await root.NOTAS_DESKTOP.keepJobStatus(ticket.id);
              if(ticket.id!==lastLocalTicket || !unlocked())break;
              const current=localStatus(state);
              status.dataset.state=state.state==='blocked'?'error':'manual';
              status.textContent=current.message;
              if(current.pending)continue;
              receivedResult=true;
              // A generated technical draft or missing source is never approval.
              break;
            }
            if(!receivedResult && ticket.id===lastLocalTicket && unlocked()){
              status.dataset.state='manual';
              status.textContent+=' O processamento ainda não terminou. Use Consultar estado do último pedido.';
            }
          }
        }catch(error){
          status.dataset.state='error';
          status.textContent='Não foi possível enviar ao MSI: '+(error?.message||'erro local');
        }finally{btn.disabled=false;}
      });
    }
  }

})(typeof window === 'object' ? window : globalThis);
