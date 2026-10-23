# Bloco de Notas Pro — Dropbox (versão de desenvolvimento)

Data: 23/10/2026
Branch: desenvolvimento/dropbox-local-first
Base do código publicado: b984514.
Revisão local de desenvolvimento: 3b02cf6 (seguida de atualização documental).

## Estado da implementação

**Implementado na cópia de desenvolvimento, não publicado:**
- Modelo local-first: gravação no dispositivo antes de qualquer transferência para a nuvem.
- Motor Dropbox com índice central de notas, ID estável, pasta associada e ficheiro JSON por nota.
- Migração expressa para modo principal Dropbox, condicionada à sincronização Supabase e a ausência de conflitos.
- Importação a partir do Dropbox quando a nota não existe no dispositivo, sem substituir dados locais.
- Escrita condicional por revisão Dropbox (CAS) para impedir sobreposição silenciosa.
- Identificação de alterações concorrentes e resolução manual: guardar a versão remota como nova nota antes de manter a versão local.
- Eliminação lógica recuperável: mantém histórico e conteúdo do ficheiro.
- Seleção de pastas Dropbox e navegação pelas notas dentro da aplicação.
- Atualização em segundo plano após guardar, ao regressar ao separador e em verificações periódicas com a aplicação aberta.
- OAuth 2.0 PKCE, state anti-CSRF e refresh token com persistência opcional cifrada no IndexedDB do navegador.
- Opção para desligar Dropbox e apagar a autorização guardada nesse navegador.
- Cópia adicional das notas no Supabase após sincronização Dropbox.

**Não concluído / não demonstrado em ambiente real:**
- Criação/associação de uma Dropbox API App do utilizador com App Key pública, scopes necessários e autorização OAuth.
- Transferência, recuperação e sincronização de notas verdadeiras na conta Dropbox e no POCO F8 Ultra.
- Abertura garantida com um único toque nos ficheiros .keepnote.json diretamente na aplicação Dropbox do Android/Windows: depende das associações do sistema operativo.
- Benchmark real com notas grandes, imagens e eventuais limites de tamanho e quota.
- Migração efetiva de dados reais, ativação Dropbox principal e publicação da aplicação.

## Verificação sem dados reais

20 testes Node passaram, incluindo controlo de revisões, migração sintética, falha de rede, conflitos e conservação de versões.
10 cenários e 125 verificações de navegador Playwright passaram, com simulação da API Dropbox, ecrã móvel estreito e armazenamento cifrado.
Estes testes NÃO confirmam compatibilidade real com uma conta Dropbox autorizada ou com o POCO F8 Ultra.

## Configuração Dropbox necessária

Dropbox App Console: https://www.dropbox.com/developers/apps
Tipo de app: Scoped access, Full Dropbox (para pastas arbitrárias).
Permissões: files.content.read, files.content.write, files.metadata.read, files.metadata.write e account_info.read (identificar a conta durante a validação OAuth).
OAuth Redirect URI exata de produção:
https://jonathanbodean40.github.io/bloco-de-notas/

A App Key é pública e pode ser inserida no diálogo da aplicação.
**Nunca** fornecer App secret, refresh tokens ou credenciais de administrador.
A autorização requer consentimento do utilizador no próprio Dropbox.

## Preservação e segurança

- Não foi acedida nenhuma nota real, nem escritos ficheiros na conta Dropbox durante o desenvolvimento.
- Não se alterou o repositório GitHub remoto nem o site publicado.
- Foi criado backup independente do código anterior no MSI.
- A proteção cifrada no navegador não é um cofre contra scripts maliciosos da mesma origem; para dados especialmente sensíveis, considerar um backend que guarde as credenciais.
- O Supabase e o armazenamento local mantêm-se até validação clínica e funcional.
- O Dropbox não substitui um backup fora da mesma conta; verificar retenção de versões e cópias offline.

## Caminhos MSI

Desenvolvimento:
C:\Users\ferna\Documents\BlocoNotasPro_Dropbox_Desenvolvimento_20261023

Cópia pré-alterações:
C:\Users\ferna\Documents\BlocoNotasPro_Backup_Codigo_AntesAlteracoes_20261023

## Testar

node --test tests\dropbox-primary.test.cjs tests\dropbox-storage.test.cjs tests\dropbox-ui.test.cjs tests\dropbox-oauth.test.cjs tests\private-access.test.cjs

node tests\startup-browser.cjs
(Definir PLAYWRIGHT_MODULE apontando à instalação Playwright existente no MSI.)

## Critério para lançamento

Só publicar e ativar Dropbox como principal depois de autorização válida, cópia verificada das notas, testes com PC e POCO, recuperação e conflitos validados com notas fictícias e plano de reversão confirmado.
