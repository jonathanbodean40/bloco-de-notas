# Correção de conflitos entre POCO F8 Ultra e MSI — versão v45

Data: 24/10/2026

## Evidência real
A ativação do armazenamento Dropbox como principal no POCO encontrou divergências.
Nos primeiros três conflitos mostrados:
- …e7cb6c01: o ficheiro principal do Dropbox está eliminado (lápide de exclusão).
- …2bb60b8d: o ficheiro principal do Dropbox também está eliminado.
- …a8483745: nota de teste ativa, com conteúdo preservado.

O estado local do POCO não foi extraído; não foi possível verificar se as versões locais estavam
ativas ou eliminadas, nem se tinham alterações reais. Não se escolheu automaticamente nenhuma versão.

## Correções no código
1. Comparação semântica das notas no motor Dropbox para evitar falsos conflitos devidos
   apenas a timestamp, tamanho/posição da janela (rect, popupRect) ou rótulo vazio «Sem título».
   Todos os campos funcionais e o HTML da nota continuam a ter de coincidir.
2. Duas lápides idênticas de exclusão podem ser reconhecidas como equivalentes mesmo com
   datas diferentes, sem ressuscitar as notas.
3. Se o texto, os objetos, as imagens, o título real ou o estado de eliminação forem diferentes,
   a sincronização continua bloqueada para revisão manual.
4. O comparador mostra o estado «Ativa»/«Eliminada» das duas versões.
5. A resolução mantém duas opções explícitas:
   - Guardar primeiro a versão Dropbox como cópia separada e manter a edição deste dispositivo.
   - Guardar primeiro a edição deste dispositivo como cópia separada, depois adotar a versão Dropbox.
   Ambas exigem confirmação e registo no índice remoto antes de substituir a versão original.
6. Notas já eliminadas permanecem eliminadas nas cópias de segurança respetivas, sem criar
   notas vazias ativas.
7. Se o POCO ainda utiliza Supabase como primário, a adoção explícita da versão Dropbox
   tem um novo timestamp local para não voltar a ser sobreposta por uma linha Supabase mais antiga.

## Testes
- 44 testes Node de Dropbox/autorização aprovados.
- 11 cenários e 149 verificações Playwright aprovadas com dados fictícios.
- Testes específicos com alterações reais de conteúdo/objetos e datas/retângulos equivalentes.
- Testes de falha do upload de backup, mudança simultânea de revisão e preservação de ambas as versões.
- Nenhuma nota real foi eliminada, alterada, migrada ou resolvida por estes testes.

## Segurança e estado
- Cópia pré-alteração do código:
  C:\Users\ferna\Documents\BlocoNotasPro_BACKUP_ANTES_COMPARACAO_SEMANTICA_20261024.zip
- Backup de dados no MSI:
  C:\Users\ferna\Documents\BlocoNotasPro_PRE_ATIVACAO_POCO_20261024.zip
- Um ficheiro histórico do teste MSI permanece fora do índice. Não deve ser eliminado.
- Ativação do POCO permanece dependente da ação do utilizador.
- A confirmação final requer nova verificação no POCO e no Dropbox.
