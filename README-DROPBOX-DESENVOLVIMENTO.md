# Bloco de Notas Pro — integração Dropbox (protótipo isolado)

Data: 23/10/2026
Origem: revisão Git b984514, 16/10/2026.
Pasta de desenvolvimento: C:\Users\ferna\Documents\BlocoNotasPro_Dropbox_Desenvolvimento_20261023

## Estado real

Implementado APENAS na cópia de desenvolvimento:
- Código de cliente Dropbox para listar pastas, criar pastas, ler notas e carregar ficheiros.
- Backups individuais com formato JSON versionado, ID estável da nota, conteúdo rico, data de alteração e link de abertura no Bloco de Notas Pro.
- Controlo de revisões Dropbox na escrita: não substitui silenciosamente alterações remotas.
- OAuth 2.0 com PKCE, estado anti-CSRF, autenticação e renovação de token enquanto durar a sessão do navegador.
- Diálogo de guardar nota por pasta, explorar/criar pastas, comparar cópia e copiar ligação direta.
- Dentro do diálogo, ficheiros .keepnote.json presentes no Dropbox abrem com um clique a nota local correspondente já sincronizada (não descarregam nem substituem dados sem validação).
- Depois de uma nota ter sido selecionada para backup, os novos cliques em Guardar podem agendar atualizações Dropbox em segundo plano enquanto a sessão estiver ligada.
- A gravação local e sincronização original Supabase continuam como antes.

Não implementado / não validado:
- Ligação real a uma aplicação Dropbox autorizada, transferência de uma nota verdadeira e teste de OAuth no POCO F8 Ultra.
- Dropbox como fonte principal de leitura para todos os dispositivos; no protótipo é uma cópia complementar e não substitui o Supabase.
- Token de renovação armazenado em servidor seguro para sessões persistentes; atualmente, fica apenas no sessionStorage e não permanece após encerrar a sessão do navegador.
- Resolução automática de conflitos simultâneos, importação/recuperação de versões divergentes e índice compartilhado de pastas entre dispositivos.
- Garantia de abertura com um único toque de ficheiros na interface da aplicação Dropbox em Android.
- Migração, alteração do projeto publicado e qualquer escrita em dados reais.

## Dependência de configuração

É necessário criar/autorizar uma aplicação no Dropbox App Console. A chave pública ("App key") pode ser introduzida no diálogo, mas NUNCA o App secret. Para escolher pastas arbitrárias, a aplicação precisa de acesso ao Dropbox completo com os scopes: files.content.read, files.content.write, files.metadata.read e files.metadata.write. Isto requer autorização expressa do titular da conta.

A URI de redirecionamento de produção deverá ser exatamente:
https://jonathanbodean40.github.io/bloco-de-notas/

Para testes locais, registar separadamente a URI HTTPS/localhost efetivamente utilizada. O protótipo não contém chaves privadas, nem tenta reutilizar as credenciais de outros conectores.

## Limitações de abertura direta

O ficheiro .keepnote.json é um backup, não um atalho do sistema operativo. Contém um campo openUrl com uma ligação autenticada à nota, mas o Dropbox não vai necessariamente abri-la ao tocar no ficheiro. A interface do Dropbox e as associações de ficheiros no Android são controladas pelo Dropbox e pelo Android. Não apresentar ao utilizador a abertura com um toque como concluída. Para garantir fluidez, a solução final deverá navegar pelas pastas Dropbox DENTRO do Bloco de Notas Pro, abrir uma nota local já sincronizada e apenas descarregar da nuvem quando estiver em falta.

## Regras de segurança

- Nunca alterar nem apagar notas reais durante ensaios iniciais.
- Criar cópia verificável do conteúdo e histórico antes da futura migração.
- Não guardar qualquer App secret, token de administrador ou service_role em ficheiros públicos.
- Não enviar conteúdo das notas a ferramentas de registo, testes ou ficheiros de evidência.
- Não converter o Dropbox em fonte principal enquanto autenticação, backup, recuperação e conflitos não estiverem validados em Windows e Android.
- Não considerar Dropbox a única cópia independente; verificar retenção de versões e eventual backup offline.

## Validação técnica

Executar na pasta do projeto:
node --test tests\dropbox-storage.test.cjs tests\dropbox-oauth.test.cjs tests\private-access.test.cjs
node --check app.js
node --check dropbox-ui.js
node --check dropbox-storage.js
node --check dropbox-oauth.js

O ensaio Playwright tests\startup-browser.cjs utiliza dados sintéticos e bloqueia acesso à Internet e aos dados verdadeiros.
Foi utilizado PLAYWRIGHT_MODULE apontando à instalação Playwright já existente no MSI.

## Passos seguintes

1. Completar a arquitetura de recuperação e mapeamento partilhado PC/POCO, com conflitos sem substituição.
2. Validar uma aplicação Dropbox de teste com credenciais públicas e consentimento do utilizador.
3. Confirmar o comportamento real da abertura nos dois sistemas, sobretudo Android.
4. Desenvolver persistência segura do token fora do JavaScript público, se for exigida sincronização contínua.
5. Testar offline, falha de rede, reentrada, edição simultânea e registos grandes.
6. Só após esses testes considerar migração gradual de armazenamento e publicação.

NENHUMA alteração foi enviada ao repositório remoto ou à aplicação pública.
