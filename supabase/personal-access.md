# Acesso pessoal ao Bloco de Notas Pro

## Estado desta alteração

Este diretório contém a migração, o inventário e a Edge Function preparados para implantação. Ainda não foram aplicados/publicados pelo trabalho de preparação aqui documentado. O proprietário foi confirmado no Auth do projeto `jashkconttgyrftcqnpw` e corroborado na conta aberta da própria aplicação: UUID `38409eff-d6a5-49ef-b2a2-1d2a8312cc1b`. Esse identificador está preenchido no parâmetro SQL e no `OWNER_ID` do backend Edge.

O objetivo é permitir a utilização apenas pela conta de Jonathan, em até três sessões de navegador autorizadas. A autorização das notas é aplicada na base de dados, além do bloqueio da interface.

## O que é protegido

`public.notes` exige simultaneamente:

1. A identidade do JWT corresponde ao UUID do proprietário, guardado em `personal_app_private.settings`.
2. O `user_id` da nota corresponde à mesma identidade.
3. O JWT contém um `session_id` UUID válido que existe em `auth.sessions`, pertence ao proprietário e não atingiu `not_after`.
4. Essa sessão foi admitida no registo privado e não foi revogada.

A política principal é `AS RESTRICTIVE FOR ALL TO PUBLIC`, com `USING` e `WITH CHECK`. Por isso, uma política permissiva antiga não permite ultrapassar as quatro condições. A migração conserva as outras políticas, ativa e força RLS e limita `authenticated` a `SELECT`, `INSERT`, `UPDATE` e `DELETE`. Revoga também privilégios explícitos de coluna; uma revogação apenas ao nível da tabela não os retiraria.

As tabelas privadas não têm permissões de leitura/escrita para os papéis da API. Têm RLS com uma política restritiva que nega operações diretas. `authenticated` recebe apenas `USAGE` do esquema e `EXECUTE` do helper booleano necessário à avaliação da política. O esquema privado deve continuar fora dos esquemas expostos pela Data API.

Os `REVOKE` explícitos protegem as funções criadas por esta migração. Para futuras funções, repetir esses `REVOKE` na mesma transação: um `ALTER DEFAULT PRIVILEGES ... IN SCHEMA ... REVOKE` não retira permissões provenientes do default global. Esta alteração não modifica os defaults globais de `postgres`.

O proprietário é uma configuração administrativa. Não se determina pela ordem de criação dos utilizadores, por um e-mail recebido do cliente, por `user_metadata`, por um nome de dispositivo ou por uma preferência local.

## Significado do limite de três

O limite é de **três sessões Supabase ativas admitidas**, não uma identificação física inviolável de três equipamentos. Várias abas que partilham a mesma sessão ocupam um lugar. Outro perfil de navegador ou um novo início de sessão pode ocupar outro lugar, mesmo no mesmo equipamento. Atualizar o access token mantendo `session_id` não cria um novo lugar.

As três primeiras sessões válidas da conta são admitidas quando chamam `personal_app_access`. As admissões e revogações usam o mesmo advisory lock de transação; a contagem e a inserção são serializadas para impedir uma quarta admissão por pedidos concorrentes. A admissão recusa transações que não sejam `READ COMMITTED`, para impedir contagens com um snapshot anterior à espera pelo lock. Não altera o isolamento global da base de dados.

Uma quarta sessão autenticada da conta pode listar os lugares ocupados e revogar um deles. Só depois de obter um lugar pode ler ou escrever notas. Uma sessão revogada conserva um tombstone: não pode readmitir-se nem gerir outros dispositivos com o mesmo `session_id`.

A revogação passa a bloquear novos pedidos à base de dados quando a transação termina. Não apaga notas já descarregadas para armazenamento local, capturas de ecrã ou cópias exportadas. Uma operação já em curso pode ter começado antes da revogação. A migração não altera `auth.sessions`; o bloqueio específico da aplicação é independente da validade residual de um JWT.

Se for necessário fixar exatamente três equipamentos previamente aprovados, é preciso acrescentar uma credencial por equipamento ou outro mecanismo de aprovação. Copiar a mesma sessão entre dispositivos não é detetável só por `session_id`. O nome apresentado na lista serve apenas para identificação visual.

## Contrato das RPCs

| Função | Entrada | Resultado |
| --- | --- | --- |
| `personal_app_access` | `p_device_name text default null` | Objeto `{allowed, reason, active_devices, max_devices: 3}`. |
| `personal_app_list_devices` | Sem argumentos | Array de `{session_id, device_name, created_at, last_seen_at, is_current}` das sessões autorizadas e ainda válidas. |
| `personal_app_revoke_device` | `p_session_id uuid` | Objeto `{revoked: boolean}`. `true` também para um registo do proprietário já revogado. |

`personal_app_access.reason` pode ser `authorized`, `unauthenticated`, `not_owner`, `device_limit`, `session_revoked` ou `invalid_session`. Para identidades não autorizadas, `active_devices` é `0` para não divulgar o uso da conta. Chamadas feitas com o papel `anon` são recusadas por falta de `EXECUTE`, antes de entrar na função.

`list_devices` e `revoke_device` permitem uma sessão válida do proprietário ainda sem lugar. Recusam identidade alheia, sessão inexistente/expirada ou sessão revogada com SQLSTATE `42501`. A listagem não devolve tokens, e-mails ou conteúdo de notas. `last_seen_at` regista a chamada de autorização, não promete detetar o momento exato de atividade de uma pessoa.

## Instalação no projeto certo

1. Confirmar o projeto Supabase usado por `config.js`. Não copiar chaves privilegiadas para o repositório ou para a interface.
2. Executar `personal-access-inventory.sql` como `postgres` no SQL Editor. Confirmar o UUID da conta de Jonathan pelo e-mail e verificar os outros utilizadores, as contagens de notas, o esquema de `auth.sessions`, as políticas, os privilégios, as views e as funções candidatas. O inventário não lê o conteúdo das notas.
3. No painel de Authentication, desativar a criação de novos utilizadores e o início de sessão anónimo, preservando o acesso da conta existente. Verificar os métodos de autenticação ativos. Essa configuração é separada desta migração e não é feita por SQL aqui.
4. Auditar e fechar as vias de partilha descritas abaixo, antes de considerar a aplicação pessoal protegida por completo.
5. Confirmar que o UUID já preenchido em `v_verified_owner_uid` e no `OWNER_ID` da Edge Function é o proprietário verificado deste projeto. O script exige o papel `postgres`, o esquema Auth esperado, uma tabela comum `public.notes` com `user_id uuid` e a assinatura revista de `claim_notes_reminders()`.
6. Executar a transação completa. Se houver qualquer erro, confirmar o `ROLLBACK`; não executar apenas os fragmentos seguintes. Repetir com o mesmo UUID é suportado. Um UUID diferente é recusado se já existe configuração.
7. Publicar `functions/notes-reminders/index.ts`, conservando os segredos existentes do cron/VAPID e as definições de invocação atuais. O gate usa o `SUPABASE_ANON_KEY` fornecido pelo ambiente Edge e o JWT do utilizador; sem essa chave ou sem a RPC disponível, recusa o pedido. Publicar também a interface com o gate correspondente e o service worker atualizado. Não chamar `dispatch` para testar a implantação.
8. Executar `personal-access-verify.sql` e validar o comportamento pelos testes abaixo. A inspeção de metadados não substitui os testes de pedidos reais.

A instalação não apaga notas de outras contas nem elimina utilizadores. As notas de outras identidades deixam de estar acessíveis pela Data API da aplicação. A necessidade de remover uma conta ou as suas notas é uma decisão separada.

## Encerramento das partilhas e proteção dos lembretes

O código publicado original foi consultado: `share-open` lia `notes_shares` com `service_role` antes de autenticar o utilizador, e `share-create` aceitava qualquer conta autenticada. A versão preparada recusa ambas as ações com HTTP 403, antes de consultar dados, independentemente do token de partilha. Não elimina as cópias armazenadas.

A função preparada conserva os handlers de definições, listagem, subscrição, gravação e estado dos lembretes. Todos exigem `getUser(token)`, o UUID fixo verificado e `personal_app_access` chamado por um cliente com a chave pública e o `Authorization` do próprio utilizador. Falta de configuração, erro da RPC ou resposta sem autorização bloqueiam o pedido antes de operar nas tabelas da aplicação.

O cron mantém a autenticação pelo seu segredo existente. `claim_notes_reminders()` conserva a ordenação por data, o lote de 40 e `FOR UPDATE SKIP LOCKED`, mas seleciona e marca apenas lembretes do proprietário definido na configuração privada. A Edge Function também filtra `OWNER_ID` antes de procurar dispositivos ou enviar notificações. As atualizações do dispatch ficam limitadas ao mesmo utilizador. Não foi executado cron, claim ou envio de notificações na produção durante a preparação.

O inventário confirmou que `notes_shares`, `notes_reminders`, `notes_push_settings`, `notes_push_devices` e `notes_push_deliveries` não concedem privilégios de tabela ou coluna a `anon`/`authenticated`; não foram encontradas views dependentes de `notes`. Isso não substitui publicar o novo código Edge: até à publicação, continuam em vigor os handlers antigos.

As chaves `service_role` e papéis com `BYPASSRLS` são privilegiados. As políticas de `notes` não são uma barreira contra código de backend que usa esses privilégios. A migração não finge remover esse poder de administração. Views executadas com privilégios do proprietário, materialized views, RPCs `SECURITY DEFINER`, buckets e endpoints que já contêm cópias também precisam de verificação. O inventário aponta candidatos; a pesquisa por nomes/código não garante uma lista completa de todas as integrações possíveis.

Enquanto o alojamento for GitHub Pages, os ficheiros estáticos publicados continuam disponíveis a quem tiver o URL. O gate e RLS restringem a utilização e os dados. Se também for necessário impedir o download da própria página, o alojamento tem de exigir autenticação antes de entregar HTML/JavaScript; isso é uma mudança de alojamento, separada desta migração.

## Validação funcional necessária

Usar o ambiente de teste ou pedidos não destrutivos contra a aplicação já configurada. Para verificar escritas, usar apenas notas de teste identificadas, sem alterar notas reais.

| Cenário | Resultado esperado |
| --- | --- |
| Sem sessão, com a chave pública | Não executa as RPCs nem lê/escreve `notes`. |
| Outra conta existente | `not_owner`; não lê as notas próprias nem as de Jonathan nesta aplicação pessoal. |
| Outra conta muda `user_metadata` para parecer o proprietário | Continua sem acesso. |
| Primeira, segunda e terceira sessões válidas do proprietário | `allowed: true`; cada `session_id` usa um lugar. |
| Quarta sessão válida | `device_limit`; não lê/escreve notas. Consegue listar os lugares e revogar um. |
| Duas admissões concorrentes disputam o terceiro lugar | Só uma nova sessão obtém o lugar; o total fica em três. |
| Admissão executada sob isolamento diferente de READ COMMITTED | A operação é recusada, sem criar um lugar. |
| Sessão revogada tenta voltar a chamar a RPC ou gerir lugares | `session_revoked` ou erro de permissão; o tombstone permanece. |
| Pedido às notas com JWT de sessão revogada | Leitura não devolve linhas; inserção/alteração proibida por RLS. |
| JWT sem `session_id`, com UUID malformado ou sessão ausente | `invalid_session`; não concede acesso nem lança um erro de cast do UUID do claim. |
| `session_id` existe, mas pertence a outro `user_id` | `invalid_session`. |
| Sessão com `not_after` ultrapassado | Não é autorizada nem ocupa lugar ativo. |
| Atualização de token mantendo o mesmo `session_id` | Mantém o lugar atual; não cria uma quarta entrada. |
| Cliente tenta inserir/alterar uma nota com outro `user_id` | Recusado por `WITH CHECK`, mesmo na sessão autorizada. |
| Política permissiva antiga permite acesso geral | A política restritiva continua a impedir acesso não autorizado. |
| Pedido direto a `share-open` com um link anterior | Não entrega conteúdo depois da correção do endpoint de partilha. |
| Novo início de sessão, recarga e atualização do service worker | O gate continua a bloquear leitura local e sincronização antes da autorização. |

SELECT, UPDATE e DELETE recusados por RLS podem afetar zero linhas sem produzir uma mensagem de erro. O critério é a ausência de dados/acesso, não a obrigatoriedade de um erro HTTP.

## Recuperação e dados conservados

O primeiro estado de `notes` fica em `personal_app_private.installation_snapshot`: proprietário, ativação/forçagem de RLS, ACLs de tabela e de colunas, políticas e data da instalação. O mesmo registo recebe, uma única vez e antes da alteração do claim, a definição integral, proprietário e ACL originais de `claim_notes_reminders()`. A adição desse campo não sobrescreve o snapshot anterior das notas. Só o administrador pode consultá-lo:

```sql
select installed_at, installed_by, original_state
from personal_app_private.installation_snapshot;
```

O snapshot é metadado para preparar uma reversão revista, não uma cópia das notas. Repetir a migração não o sobrescreve, não redefine o proprietário e não apaga dispositivos nem tombstones. Não existe reversão automática que reabra acesso público. Se for necessário reverter, preparar conjuntamente a versão anterior da interface e o restauro das políticas/ACLs relevantes a partir do snapshot, após rever a consequência de cada permissão.

## Comportamento da interface pessoal

A interface exige ligação à Internet para confirmar a autorização no servidor. Antes dessa confirmação, não executa o editor nem carrega as notas locais. A perda da ligação, a expiração da sessão ou uma revogação detetada podem bloquear o editor. Esta versão não mantém o anterior modo visitante/offline como alternativa à autorização.

As notas já guardadas permanecem no armazenamento local. Antes de um bloqueio ou de recarregar após terminar sessão, as alterações por guardar recebem um rascunho em `sessionStorage`; são recuperadas depois de voltar a entrar. Se o navegador não permitir guardar esse rascunho, a página não é recarregada automaticamente, para conservar o conteúdo em memória. Isto protege contra perda acidental e não constitui encriptação das cópias locais.

Terminar sessão utiliza o âmbito `local` do Supabase, preservando as sessões dos restantes dispositivos. A partilha pública foi removida da interface; a sua desativação no servidor depende da publicação da Edge Function preparada.

## Limites da verificação local

O teste reprodutível `node tests/private-access.test.cjs` aprovou 15 cenários do gate, incluindo conta não autorizada, limite de sessões, revogação, falha da RPC e respostas tardias depois de terminar sessão. Os testes usam um ambiente simulado em Node, sem contas reais, rede ou navegador. As verificações de sintaxe de `app.js`, `private-access.js` e `service-worker.js`, e `git diff --check`, também passaram. A inspeção visual e o fluxo completo com uma conta real continuam pendentes.

O ambiente de preparação não contém PostgreSQL nem um parser PostgreSQL instalado. Não foram instaladas dependências e não se executou a migração ou testes de integração no Supabase. O código foi revisto estaticamente; a compilação PL/pgSQL, o esquema real, a concorrência e os pedidos da API continuam por validar no projeto de destino.

## Referências técnicas

- [Supabase — Sessions](https://supabase.com/docs/guides/auth/sessions): relação entre JWT, `session_id`, sessão ativa e limites de sessão.
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): políticas, `auth.uid()`, metadados e papéis que ignoram RLS.
- [Supabase — Database Functions](https://supabase.com/docs/guides/database/functions): funções `SECURITY DEFINER`, `search_path` e permissões de execução.
- [PostgreSQL — CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html): combinação entre políticas permissivas e restritivas, `USING` e `WITH CHECK`.
- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html): advisory locks com duração da transação.
- [PostgreSQL — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html): diferença entre defaults globais e concessões por esquema.
