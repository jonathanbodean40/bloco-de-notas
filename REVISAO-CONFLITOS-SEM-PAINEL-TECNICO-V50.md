# Bloco de Notas Pro — v50: revisão contextual de conflitos Dropbox
Data: 27/10/2026

## Incidente
No POCO F8 Ultra a página principal mostrava «1 conflito(s) Dropbox. As notas locais foram preservadas; reveja antes de continuar». O botão Dropbox do rodapé tinha sido ocultado na versão v49 para conservar apenas três opções no menu Partilhar. A comparação das versões permaneceu funcional no código mas já não era acessível por um controlo visual.

## Objetivo
Aceder à comparação sem reabrir as definições técnicas Dropbox. Não misturar as opções de partilha com a gestão interna da sincronização.

## Interface
- Quando a reconciliação detecta uma ou mais divergências, aparece o botão contextual «Resolver 1 conflito Dropbox» (ou contagem correspondente), imediatamente acima do rodapé.
- Se a sincronização não detectar conflito, o botão permanece completamente oculto.
- O botão abre uma janela focada «Resolver conflitos de sincronização», com o identificador, estado de exclusão, datas e prévias das versões local e Dropbox.
- Os dois botões de decisão permanecem desativados até se clicar «Comparar as duas versões».
- O botão «Verificar novamente (apenas leitura)» compara o estado sem escrita, upload, importação ou substituição.
- As duas decisões preservam previamente uma cópia independente da versão concorrente, no Dropbox e localmente, antes de aplicar qualquer substituição (mecânica preexistente).
- A resolução exige confirmação expressa; um falhanço mantém o conflito visível e ambas as versões originais.
- Fechar a comparação sem decidir deixa ambas as versões inalteradas.
- O acesso contextual desaparece quando os conflitos são resolvidos ou a sincronização não encontra novas divergências.
- Ao bloquear a sessão privada, a janela fecha e os dados de comparação são retirados da interface.
- O menu Partilhar continua a apresentar exclusivamente Dropbox, WhatsApp e Gmail. Não é adicionado um botão técnico permanente.
- Os dados armazenados, mapeamento de notas, índices e permissões Dropbox não são alterados na atualização do código.

## Backups independentes
- Código Git anterior: C:\Users\ferna\Documents\BlocoNotasPro_CODIGO_PRE_CORRECAO_CONFLITOS_20261027.zip
- Ficheiros Dropbox antes de v50: C:\Users\ferna\Documents\BlocoNotasPro_PRE_CORRECAO_CONFLITOS_20261027.zip
- 55 ficheiros verificados por SHA-256 antes do início das alterações.
- Não foi escolhida qualquer versão de uma nota real durante o desenvolvimento.

## Validação de desenvolvimento
- Testes unitários com conflito, comparação read-only, duas decisões e proteção contra eliminação de conteúdo.
- Browser sintético com 393×852 simula duas edições independentes: alerta visível, comparação, sem perda de dados nem operações de escrita durante a consulta.
- Compatibilidade com a ferramenta KEEP ALIGNER, autenticação, sincronização Dropbox/Supabase e partilha v49.
- Ainda requer identificação e revisão do conflito real no POCO pelo utilizador.
