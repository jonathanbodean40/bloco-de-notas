# Dropbox — correção de falso conflito por representação de data (24/10/2026)

## Confirmação no MSI real
- A aplicação encontra-se autenticada no Chrome do MSI.
- A migração inicial foi interrompida na comparação da nota «Sem título».
- O botão «Comparar as duas versões» foi testado na sessão real sem escrita.
- Prévia: mesmo conteúdo e mesma contagem (747 caracteres) em ambas as versões.
- Datas observadas: 2026-10-22T10:37:10.980Z e 2026-10-22T10:37:10.98+00:00.
- As datas representam o MESMO instante Unix em milissegundos: 1792665430980.
- A primeira comparação usava o texto literal da data no hash e criava falso conflito.

## Alteração segura
- Normalização semântica de updatedAt e deletedAt em SHA-256 da nota.
- Todas as propriedades clínicas/HTML continuam a ser comparadas literalmente.
- Hashes antigos dos checkpoints locais continuam aceites durante a migração gradual.
- Diferenças verdadeiras no conteúdo, ID, título e outros campos continuam a bloquear a ativação.
- O conteúdo das notas não é modificado para normalizar a data.
- Sem operações de eliminação ou resolução forçada de conflitos.
- Service worker atualizado para v43.

## Verificação automatizada
- 33 testes Node aprovados.
- 11 cenários Playwright e 149 verificações aprovados.
- Novo teste de carimbos temporais equivalentes, sem criação de nova revisão.
- Novo teste de conteúdos diferentes com data equivalente; mantém conflito.
- Teste de atualização transparente dos checkpoints legados sem upload remoto.
- Teste de datas de exclusão equivalentes.

## Plano
1. Publicar no GitHub preservando revisão anterior.
2. Confirmar os ficheiros do GitHub Pages.
3. Atualizar a sessão do navegador Chrome no MSI.
4. Repetir a ativação, observando o estado e sem escolher versões conflitantes.
5. Se surgir outro conflito real, comparar antes de qualquer substituição.
6. Só declarar ativo quando a aplicação confirmar.
