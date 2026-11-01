# KEEP ALIGNER — sessão técnica de 2026-11-01 à noite

## Estado exato

Integração nativa demonstrada com dados e modelos inteiramente fictícios. NÃO homologada para pacientes e NÃO instalada em produção. Esta entrada é documentação; o código desta sessão permanece gravado no worktree do MSI, ainda sem commit/push, porque a ligação Keep Remote ficou offline antes do fecho.

Base remota verificada: `ebde9ff`. Worktree: `C:\Users\ferna\Documents\KeepAligner_SafeDev_20261101`. Ramo local: `work/keep-integration-20261101-night`. Destino de desenvolvimento: `feature/independent-windows-android`. Preservar as alterações locais e não usar reset/clean.

## Alterações gravadas no MSI

- `executor/output_validation.py`: verificação de recibos e ficheiros produzidos, identidade/versão/modo, hash da ficha, ficheiros obrigatórios, hashes SHA-256, integridade/estrutura/número de páginas PPTX, PNG 4K da comparação, relatórios de renderização PowerPoint sem overflow, validações independentes e existência da prévia HTML. Não concede aprovação clínica ou autorização de publicação.
- `executor/agent.py`: estados validating_sources, generating e validating_outputs; pedido de renderização nativa; um exit code zero sem pacote verificável passa a bloquear. A integração nova exige `synthetic_only is True`; casos não marcados explicitamente como fictícios ficam em awaiting_integration_validation. O marcador não anonimiza dados nem autoriza usar casos reais.
- `executor/source_preflight.py`: cabeçalhos CSV UTF-16 com BOM e UTF-8, separadores tabulação/vírgula, rejeição de UTF-32 e limite de leitura do cabeçalho. Não valida por si só o conteúdo clínico.
- `desktop/main.cjs` e `keep-aligner-tool.js`: progresso e contagem de ficheiros verificados na consulta de estado; estados em processamento não são tratados como conclusão; aprovação clínica e publicação permanecem falsas.
- Novos testes: `tests/test_output_validation.py`, `tests/keep-local-progress.test.cjs`, `tests/keep-electron-progress-smoke.cjs`; atualização dos testes Python existentes.
- `scripts/keep-workflow-acceptance.py`: ensaio opt-in com cópia dos quatro ficheiros de código do gerador, um parágrafo de estilo comprovadamente vazio, modelos PPTX construídos do zero, fontes fictícias e PowerPoint real. Não abre modelos clínicos nem usa a fila instalada. Gera uma guia, uma apresentação e repete a apresentação para verificar reutilização das etapas.
- `.github/workflows/build-native.yml`: testes Node de progresso/fila adicionados ao job preflight, ainda não enviados nem executados no GitHub.
- `.gitignore`: exclusão de .runtime e caches Python, sem eliminar esses ficheiros.
- `tests/keep-aligner-tool.test.cjs`: limite explícito de 15 segundos para a espera do service worker, de forma a diagnosticar recursos de build ausentes em vez de bloquear indefinidamente.

## Resultados efetivamente observados

1. Bateria Python final: **76 testes executados; 75 aprovados; 1 omitido** por indisponibilidade de ligações simbólicas na conta Windows. Inclui a restrição da integração nativa a fixtures fictícias.
2. Testes Node de estados/progresso e fila isolada: aprovados.
3. Teste Electron do código atual, com perfil/fila temporários e página estática offline: aprovado. Verificou botão de envio, progresso 2/3, consulta manual, 9 ficheiros e ausência de aprovação/publicação automática.
4. Ensaio nativo: **3 execuções aprovadas** — guia, apresentação, repetição da apresentação. Os ficheiros foram realmente gerados pelo motor existente e renderizados em PowerPoint; não houve mock do subprocesso gerador. As etapas concluídas foram reutilizadas na repetição. O recibo manteve clinicalApproval=false e publishingAuthorized=false.
5. Inspeção das três prévias fictícias: realizadas; texto legível sem cortes observados e oito posições na comparação. Isto NÃO valida odontograma clínico, attachments, IPR, botões/elásticos ou capturas anatómicas reais.
6. Regressão extensa do navegador: 18 verificações passaram antes de a espera do service worker ficar bloqueada. Causa confirmada: faltava apenas `native-auth.js`, um recurso gerado e ignorado pelo Git. O recurso foi compilado apenas no worktree de teste a partir do código existente. A sessão de teste bloqueada foi interrompida. A repetição final NÃO executou: o Keep Remote respondeu que o dispositivo estava offline e nenhum comando tinha sido executado.
7. A repetição nativa final, após os últimos ajustes de bloqueio e estrutura PPTX, e a verificação final de independência/diff/commit/push ficaram pendentes na mesma interrupção. Não interpretar os testes anteriores como confirmação dessa última repetição.

Evidência do ensaio nativo aprovado, preservada localmente:
`.runtime/keep-mock-acceptance-xyf9wqy6/acceptance-report.json`

As prévias e documentos fictícios estão dentro da subpasta `runtime/KEEP ALIGNER GENERATOR/jobs/` desse ensaio. Não são modelos clínicos aprovados nem devem ser usados em pacientes.

## Bloqueios e limites

- O módulo proposto `executor/workflow_contract.py`, para ligar antecipadamente todos os caminhos da ficha aos recursos exatos do manifesto, NÃO foi criado: a ferramenta bloqueou essa gravação por segurança. Não foi contornado através de outro conector. Essa associação completa continua por implementar/validar e impede homologação para casos reais.
- My Keep/Hirsch/Onyx continuam simulados. A recolha autenticada e as capturas 3D anatómicas reais não foram implementadas ou testadas nesta sessão. Não houve acesso a pacientes.
- O ensaio usa modelos sintéticos construídos do zero, não os modelos clínicos oficiais. Não confirma a fidelidade gráfica clínica destes últimos.
- Refinamento simples e idiomas/mecânicas sem homologação no gerador não ficam automaticamente cobertos por estes ensaios de guia/apresentação completa.
- A instalação Windows 0.1.3 e o executor instalado não foram substituídos. Não foram modificadas notas, autenticação, base Supabase ou ficheiros clínicos. Não houve publicação, arquivo INFORME, chamadas automáticas Codex ou eliminação de backups.

## Retoma segura

Confirmar primeiro que o mesmo MSI voltou a estar online. Inspecionar git status e os ficheiros locais antes de qualquer alteração. Não recriar o trabalho nem sobrepor ficheiros não commitados. Preparar o recurso de build de teste em falta, repetir a regressão do navegador, o teste de independência e o ensaio nativo; executar diff/check; só então guardar um commit de código e sincronizar o ramo de desenvolvimento, considerando este commit documental entretanto acrescentado.

Resolver o bloqueio de associação ficha/fontes antes de ativar a integração para dados reais. A validação de fornecedores reais exige autorização específica de leitura e um caso de teste autorizado; aprovação clínica e publicação continuam a exigir intervenção humana separada.
