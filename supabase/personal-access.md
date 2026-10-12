# Acesso pessoal ao Bloco de Notas Pro

## Estado desta alteração

**Estado confirmado em 12 de outubro de 2026: o backend foi aplicado e validado; a nova interface ainda não foi publicada.** O projeto é `jashkconttgyrftcqnpw`. A identidade do proprietário foi confirmada no Auth e corroborada na conta aberta da aplicação publicada. O UUID verificado está preenchido na configuração privada do banco e no `OWNER_ID` da Edge Function.

| Componente | Estado confirmado |
| --- | --- |
| Migração SQL e RLS | Aplicadas integralmente; snapshot registado em `2026-10-12T17:15:48Z`. Políticas, ACLs e cópia original de `claim_notes_reminders()` verificadas. |
| Autenticação | Criação de novas contas desativada: `disable_signup=true`. Início de sessão anónimo desativado: `anonymous=false`. |
| RPCs, limite e revogação | Teste administrativo PostgreSQL com 20 casos funcionais e quatro verificações de preparação/restauração: **24 OK, zero falhas**. |
| Edge Function `notes-reminders` | Publicada. Ambas as ações de partilha recusaram os pedidos HTTP de verificação com 403. |
| Acesso sem sessão | Pedidos HTTP a `notes` e a `personal_app_access` recusados com HTTP 401 e SQLSTATE `42501`. |
| Nova interface e service worker | Preparados e testados localmente, **ainda não publicados**. `main` permanece em `62bdf41`. |

A tentativa de enviar a branch de preparação para o GitHub foi rejeitada pela revisão automática, que exigiu autorização explícita do utilizador para o push. A publicação da interface continua pendente dessa autorização e do respetivo deployment. A versão antiga pode ficar sem sincronizar até a nova interface admitir uma sessão real através de `personal_app_access`: o teste do banco terminou com zero dispositivos registados, por ter sido integralmente revertido.

O objetivo é permitir a utilização apenas pela conta de Jonathan, em até três sessões de navegador autorizadas. A autorização das notas é aplicada na base de dados, além do bloqueio da interface.

## Registo da implantação e das verificações realizadas

A versão de `personal-access.sql` efetivamente executada tem SHA-256:

```text
709148c893c291f54079ad881e93d7b80619872acfc7c8c84173a61f1e829199
```

Depois da execução, apenas o comentário do cabeçalho foi atualizado para remeter para o estado deste documento. Por isso, o hash do ficheiro atual difere do hash acima; o conteúdo SQL a partir de `BEGIN;` conserva-se byte a byte. Não é necessário executar novamente a migração por causa desta atualização documental.

O [teste de sessões](personal-access-session-test.sql) usou quatro sessões Auth reais do proprietário, selecionadas internamente, sem devolver os respetivos IDs ou tokens. As chamadas às RPCs e as contagens de notas executaram sob `SET LOCAL ROLE authenticated`, com claims locais controlados pelo administrador. Foram confirmados:

- Admissão das sessões 1, 2 e 3; recusa da quarta com `device_limit` e zero notas visíveis nessa sessão.
- Recusa de outra identidade existente: zero notas e gestão de dispositivos negada.
- Listagem e revogação pela quarta sessão, substituição de um lugar e permanência do limite de três.
- Impossibilidade de readmissão ou gestão pela sessão revogada, incluindo depois da substituição.
- Leitura autorizada de todas as notas do proprietário, sem notas de outra identidade.
- Verificação do papel e dos claims em todos os casos e reposição dos cinco GUCs, do papel e de `session_user`.

As 24 linhas de resultado foram recolhidas e todas apresentaram `OK`. O `ROLLBACK` final foi confirmado por uma leitura administrativa posterior:

| Estado após o teste | Confirmação |
| --- | --- |
| `personal_app_private.devices` | Vazio, com zero registos, como antes do teste. |
| Notas do proprietário e das outras contas | Contagens preservadas. |
| Utilizadores e sessões Auth | Contagens preservadas; nenhum registo criado, alterado ou eliminado pelo teste. |

O teste não escreveu em `auth.*` nem nas notas; as admissões, revogações e limpeza temporária do registo privado foram revertidas. Esta prova verifica a camada do banco com identidades e sessões existentes; não equivale a iniciar sessão através de HTTP ou da nova interface em quatro navegadores.

Às **`2026-10-12 17:32:41 UTC`**, depois da publicação da Edge Function, foram confirmados os seguintes resultados HTTP:

| Pedido ou configuração verificada | Resultado |
| --- | --- |
| `share-open`, com token fictício de 72 zeros | HTTP 403; mensagem «As partilhas estão desativadas nesta aplicação pessoal.» |
| `share-create`, sem enviar uma nota | HTTP 403; a mesma mensagem de partilhas desativadas. |
| Leitura de `notes` com `limit=0`, sem sessão | HTTP 401; SQLSTATE `42501`. Não foi solicitado conteúdo de notas. |
| Chamada a `personal_app_access`, sem sessão | HTTP 401; SQLSTATE `42501`. |
| Configuração pública de Auth | `disable_signup=true` e `anonymous=false`. |

Não foram usados tokens reais de partilha, alteradas notas ou contas, nem invocados `dispatch`, `claim_notes_reminders()` ou envios de notificações pelos procedimentos de validação. O acesso com a conta real através do novo gate permanece pendente da publicação da interface.

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

## Procedimento de instalação e manutenção

O estado da instalação atual está registado acima. A sequência seguinte serve de referência para uma implantação revista ou repetição controlada; a atualização documental não exige repetir estes passos.

1. Confirmar o projeto Supabase usado por `config.js`. Não copiar chaves privilegiadas para o repositório ou para a interface.
2. Executar `personal-access-inventory.sql` como `postgres` no SQL Editor. Confirmar o UUID da conta de Jonathan pelo e-mail e verificar os outros utilizadores, as contagens de notas, o esquema de `auth.sessions`, as políticas, os privilégios, as views e as funções candidatas. O inventário não lê o conteúdo das notas.
3. No painel de Authentication, desativar a criação de novos utilizadores e o início de sessão anónimo, preservando o acesso da conta existente. Verificar os métodos de autenticação ativos. Essa configuração é separada desta migração e não é feita por SQL aqui.
4. Auditar e fechar as vias de partilha descritas abaixo, antes de considerar a aplicação pessoal protegida por completo.
5. Confirmar que o UUID já preenchido em `v_verified_owner_uid` e no `OWNER_ID` da Edge Function é o proprietário verificado deste projeto. O script exige o papel `postgres`, o esquema Auth esperado, uma tabela comum `public.notes` com `user_id uuid` e a assinatura revista de `claim_notes_reminders()`.
6. Executar a transação completa. Se houver qualquer erro, confirmar o `ROLLBACK`; não executar apenas os fragmentos seguintes. Repetir com o mesmo UUID é suportado. Um UUID diferente é recusado se já existe configuração.
7. Publicar `functions/notes-reminders/index.ts`, conservando os segredos existentes do cron/VAPID e as definições de invocação atuais. O gate usa o `SUPABASE_ANON_KEY` fornecido pelo ambiente Edge e o JWT do utilizador; sem essa chave ou sem a RPC disponível, recusa o pedido. Publicar também a interface com o gate correspondente e o service worker atualizado, após a autorização exigida para o GitHub. A Edge Function já foi publicada nesta implantação; a interface é a parte ainda pendente. Não chamar `dispatch` para testar a implantação.
8. Executar `personal-access-verify.sql` e validar o comportamento pelos testes abaixo. `personal-access-session-test.sql` permite repetir a prova administrativa de sessões, desde que os seus pré-requisitos continuem satisfeitos, e termina com `ROLLBACK`. A inspeção de metadados e os claims locais de teste não substituem a validação do login real da interface.

A instalação não apaga notas de outras contas nem elimina utilizadores. As notas de outras identidades deixam de estar acessíveis pela Data API da aplicação. A necessidade de remover uma conta ou as suas notas é uma decisão separada.

## Encerramento das partilhas e proteção dos lembretes

O código publicado original foi consultado: `share-open` lia `notes_shares` com `service_role` antes de autenticar o utilizador, e `share-create` aceitava qualquer conta autenticada. A versão agora publicada recusa ambas as ações com HTTP 403, antes de consultar dados, independentemente do token de partilha. Não elimina as cópias armazenadas. O bloqueio foi confirmado pelos pedidos HTTP registados acima.

A função publicada conserva os handlers de definições, listagem, subscrição, gravação e estado dos lembretes. Todos exigem `getUser(token)`, o UUID fixo verificado e `personal_app_access` chamado por um cliente com a chave pública e o `Authorization` do próprio utilizador. Falta de configuração, erro da RPC ou resposta sem autorização bloqueiam o pedido antes de operar nas tabelas da aplicação.

O cron mantém a autenticação pelo seu segredo existente. `claim_notes_reminders()` conserva a ordenação por data, o lote de 40 e `FOR UPDATE SKIP LOCKED`, mas seleciona e marca apenas lembretes do proprietário definido na configuração privada. A Edge Function também filtra `OWNER_ID` antes de procurar dispositivos ou enviar notificações. As atualizações do dispatch ficam limitadas ao mesmo utilizador. Os procedimentos desta implantação não invocaram o cron, o claim ou o envio de notificações em produção.

O inventário confirmou que `notes_shares`, `notes_reminders`, `notes_push_settings`, `notes_push_devices` e `notes_push_deliveries` não concedem privilégios de tabela ou coluna a `anon`/`authenticated`; não foram encontradas views dependentes de `notes`. A publicação do novo código Edge foi concluída, fechando também as duas ações de partilha que utilizavam `service_role`.

As chaves `service_role` e papéis com `BYPASSRLS` são privilegiados. As políticas de `notes` não são uma barreira contra código de backend que usa esses privilégios. A migração não finge remover esse poder de administração. Views executadas com privilégios do proprietário, materialized views, RPCs `SECURITY DEFINER`, buckets e endpoints que já contêm cópias também precisam de verificação. O inventário aponta candidatos; a pesquisa por nomes/código não garante uma lista completa de todas as integrações possíveis.

Enquanto o alojamento for GitHub Pages, os ficheiros estáticos publicados continuam disponíveis a quem tiver o URL. O gate e RLS restringem a utilização e os dados. Se também for necessário impedir o download da própria página, o alojamento tem de exigir autenticação antes de entregar HTML/JavaScript; isso é uma mudança de alojamento, separada desta migração.

## Critérios funcionais e cobertura complementar

Os resultados efetivamente obtidos estão separados na secção de implantação. A tabela seguinte descreve os critérios do sistema; não significa que cada linha tenha sido ensaiada em produção. A prova real de login, recarga e atualização do service worker aguarda a publicação da interface. Os ensaios de concorrência, de outros isolamentos e de escrita de notas não foram executados em produção.

Para verificações complementares, usar o ambiente de teste ou pedidos não destrutivos contra a aplicação configurada. Para verificar escritas, usar apenas notas de teste identificadas, sem alterar notas reais.

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

## Comportamento da interface preparada, ainda não publicada

Esta secção descreve a nova versão presente no código, não a versão que continua publicada em `main` no commit `62bdf41`. A sua utilização com a conta real ainda precisa de validação depois do deployment.

A interface exige ligação à Internet para confirmar a autorização no servidor. Antes dessa confirmação, não executa o editor nem carrega as notas locais. A perda da ligação, a expiração da sessão ou uma revogação detetada podem bloquear o editor. Esta versão não mantém o anterior modo visitante/offline como alternativa à autorização.

As notas já guardadas permanecem no armazenamento local. Antes de um bloqueio ou de recarregar após terminar sessão, as alterações por guardar recebem um rascunho em `sessionStorage`; são recuperadas depois de voltar a entrar. Se o navegador não permitir guardar esse rascunho, a página não é recarregada automaticamente, para conservar o conteúdo em memória. Isto protege contra perda acidental e não constitui encriptação das cópias locais.

Terminar sessão utiliza o âmbito `local` do Supabase, preservando as sessões dos restantes dispositivos. A nova interface remove a partilha pública. O servidor já recusa ambas as ações de partilha, incluindo pedidos que ainda venham da interface antiga.

## Testes locais e limites da validação

O teste reprodutível `node tests/private-access.test.cjs` aprovou **15 cenários do gate**, incluindo conta não autorizada, limite de sessões, revogação, falha da RPC e respostas tardias depois de terminar sessão. Os testes usam um ambiente simulado em Node, sem contas reais, rede ou navegador. As verificações de sintaxe de `app.js`, `private-access.js` e `service-worker.js`, e `git diff --check`, também passaram. A inspeção visual do novo gate e o fluxo completo com uma conta real continuam pendentes.

O teste `node --experimental-vm-modules --test supabase/tests/notes-reminders-handler.test.cjs` aprovou **seis cenários do handler Edge**. Usa o parser TypeScript do Node 24 e módulos VM com mocks de Supabase e Web Push, sem rede nem notificações reais. Verificou partilhas recusadas antes de Auth/DB, tokens e identidade inválidos, falhas/negações da RPC, JWT do proprietário na RPC, segredo de cron incorreto e filtragem de lembretes de outra identidade antes de enviar notificações simuladas.

O ambiente local não contém PostgreSQL ou parser PostgreSQL e não foram instaladas dependências. A migração foi posteriormente executada com sucesso no Supabase, os metadados foram verificados e o teste administrativo de sessões passou os 24 resultados. Os pedidos HTTP de partilha e de acesso sem sessão também foram verificados no projeto real. Continuam por ensaiar em produção a concorrência entre ligações distintas, as escritas protegidas por RLS e os fluxos autenticados da nova interface. Não foi feito um envio real de notificações para testar o cron.

## Referências técnicas

- [Supabase — Sessions](https://supabase.com/docs/guides/auth/sessions): relação entre JWT, `session_id`, sessão ativa e limites de sessão.
- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): políticas, `auth.uid()`, metadados e papéis que ignoram RLS.
- [Supabase — Database Functions](https://supabase.com/docs/guides/database/functions): funções `SECURITY DEFINER`, `search_path` e permissões de execução.
- [PostgreSQL — CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html): combinação entre políticas permissivas e restritivas, `USING` e `WITH CHECK`.
- [PostgreSQL — Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html): advisory locks com duração da transação.
- [PostgreSQL — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html): diferença entre defaults globais e concessões por esquema.
