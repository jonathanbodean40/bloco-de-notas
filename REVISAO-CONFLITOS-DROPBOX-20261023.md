# Revisão segura de conflitos Dropbox — Bloco de Notas Pro

Data: 23/10/2026

## Motivação

Durante a migração inicial para Dropbox como armazenamento principal,
foi detetada uma nota sem título com versões divergentes no MSI e no Dropbox.
A migração foi bloqueada intencionalmente para evitar uma substituição silenciosa.

## Alterações implementadas

- «Comparar as duas versões» apresenta uma prévia textual local e remota,
  com datas registadas na nota, de forma não executável (textContent).
- A interface identifica a nota conflituosa pelo sufixo do ID.
- A comparação é só de leitura, sem operações de gravação.
- A resolução «Preservar ambas as versões e usar esta edição»
  importa a cópia remota localmente e assegura que essa cópia foi
  gravada e indexada no Dropbox ANTES de substituir a nota original.
- Se falhar a gravação da cópia remota, a nota principal não é substituída.
- Se a revisão remota ou o conteúdo local mudar durante a operação, a
  substituição fica bloqueada.
- A escolha permanece inteiramente manual, com confirmação expressa.
- Nova versão do service worker (v42) para evitar reutilizar scripts antigos.

## Testes sintéticos

- Preservação das duas versões após resolução explícita.
- Segurança do backup remoto ANTES de qualquer substituição.
- Falha de escrita simulada não altera a nota original.
- Comparação sem mutação de dados e sem executar conteúdo HTML.
- 29 testes Node (Dropbox e autenticação) aprovados.
- 11 cenários e 149 verificações browser Playwright aprovados.

## Limites

- A revisão automática não decide qual conteúdo clínico é correto.
- A prévia textual pode omitir imagens e objetos gráficos; se houver diferenças
  dessa natureza, as duas versões devem ser preservadas para revisão manual.
- Nenhuma nota real foi modificada durante este desenvolvimento ou nos testes.
- Um backup independente do estado após migração foi criado anteriormente no MSI.
- Não apagar nenhuma cópia sem autorização expressa.
