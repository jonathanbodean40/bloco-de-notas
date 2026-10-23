# Correção Dropbox 409 — pasta inexistente

Data: 23/10/2026
Ocorrência: ao escolher /Notas Pro, a aplicação mostrava
"Conflito Dropbox: a versão na nuvem foi alterada e não foi substituída".

## Diagnóstico
A pasta /Notas Pro não existia na conta Dropbox conectada.
As pastas /Bloco de Notas Pro/Notas e /Bloco de Notas Pro/Testes OAuth existiam.
A API Dropbox usa HTTP 409 tanto para path/not_found como para path/conflict.
O tratamento anterior considerava qualquer 409 como conflito de versões.

## Correção
- Distinguir tipos de erro Dropbox por error_summary.
- Criar a pasta e subpastas pretendidas apenas depois de clicar expressamente em
  "Guardar cópia desta nota" ou "Criar pasta".
- Confirmar pastas existentes sem sobrescrever ficheiros ou eliminar pastas.
- Manter proteção por revisão (CAS) na escrita de notas e recusar substituição
  de ficheiros existentes quando a revisão é desconhecida.
- Usar /Bloco de Notas Pro/Notas como sugestão inicial para novos utilizadores,
  preservando as pastas selecionadas que já estejam guardadas no navegador.
- Mensagens de erro diferenciadas para caminho inexistente, conflito real e
  permissões de acesso.
- Nova cache de Service Worker v41 para atualização da versão web/PWA.

## Validação
- 6 testes adicionais em tests/dropbox-folder.test.cjs aprovados,
  com caminhos inexistentes, pastas aninhadas, revisão desconhecida e permissões.
- O ensaio Playwright tests/startup-browser.cjs inclui agora o caso:
  "current-manual-missing-folder", verificando criação da pasta inexistente,
  escrita, leitura do índice local de mapeamento e atualização subsequente por rev.
- Nunca leram nem escreveram notas reais durante os testes de correção.

## Reversão
A revisão pública anterior é f0a8c63 e o pacote de backup já existe no MSI.
Nenhum ficheiro Dropbox existente deve ser apagado para desfazer esta alteração.
