# Versão 51 — funcionamento sem Dropbox

Removidos os módulos de armazenamento, sincronização, OAuth e autorização persistente Dropbox, os diálogos de exportação/partilha que os utilizavam e o aviso de conflitos. A sincronização volta a ler e gravar diretamente na conta Supabase, com a mesma gravação local e formato das notas anteriores à integração. A ordenação por gesto e a ferramenta KEEP ALIGNER foram preservadas.

Não são apagadas notas locais, notas da conta ou cópias já existentes no Dropbox. Definições antigas do modo Dropbox deixam de ser consultadas. A aplicação deixa de carregar código que possa usar ou renovar a autorização Dropbox. A revogação de uma autorização já concedida pode ser feita nas aplicações ligadas das definições da própria conta Dropbox.

A cache passa a `notas-pro-v51-sem-dropbox`: a ativação remove as caches antigas da aplicação, sem limpar o armazenamento das notas. A atualização precisa de ser publicada e recebida pelo dispositivo; o código foi validado localmente, sem publicação nem acesso a contas reais.

Verificação com perfis descartáveis e notas sintéticas: gravação e reabertura em ecrã móvel; sincronização normal com a conta simulada mesmo com a chave antiga de modo principal ativa; ausência de interface/scripts/pedidos Dropbox; autenticação, bloqueios, edição, ferramenta KEEP ALIGNER e funcionamento offline. A suite de arranque anterior à integração foi recuperada para testar o fluxo restaurado.
