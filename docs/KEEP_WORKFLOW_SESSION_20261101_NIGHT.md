# KEEP ALIGNER — integração técnica de 2026-11-01

## Estado final desta sessão

O percurso **fontes simuladas → pré-validação → fila isolada → gerador real → PowerPoint nativo → verificação dos ficheiros → revisão humana pendente** foi executado e passou no MSI. Também passou o teste da interface Electron com progresso e consulta manual.

Isto é aceitação técnica **com dados e modelos inteiramente fictícios**, não homologação clínica nem integração autenticada My Keep/Hirsch/Onyx. A aplicação Windows 0.1.3 e o executor instalado não foram substituídos.

O MSI ficou temporariamente offline durante a sessão, mas a ligação foi restabelecida. A última repetição dos testes foi concluída com sucesso depois da reconexão. Este estado substitui o relato intermédio de interrupção guardado no commit documental 8c768d4.

Worktree: `C:\Users\ferna\Documents\KeepAligner_SafeDev_20261101`. Ramo local: `work/keep-integration-20261101-night`. Destino de desenvolvimento: `feature/independent-windows-android`.

## Implementação

- `executor/output_validation.py`: valida recibos e ficheiros efetivamente produzidos, caso/versão/modo, hash da ficha, conjunto exato de documentos, hashes SHA-256, estrutura e páginas PPTX, integridade PNG, comparação 4K, relatórios nativos sem overflow, validações independentes e presença da prévia HTML. Um exit code zero sem pacote verificável não é sucesso. Não confirma correção clínica nem autenticidade do fornecedor.
- `executor/agent.py`: estados `validating_sources`, `generating`, `validating_outputs` e `awaiting_visual_review`. Solicita renderização nativa e exige a verificação dos resultados. A integração está limitada a fichas com `synthetic_only is True`; restantes ficam em `awaiting_integration_validation`. O marcador não anonimiza dados nem autoriza usar casos reais.
- `executor/source_preflight.py`: cabeçalhos UTF-16 com BOM/UTF-8, separador tabulado/vírgula, rejeição de UTF-32 e limite de leitura do cabeçalho. Não substitui a análise de valores pelo gerador nem a revisão clínica.
- `desktop/main.cjs` e `keep-aligner-tool.js`: consulta de progresso e contagem de documentos verificados; estados intermédios não são tratados como conclusão. Aprovação clínica e publicação permanecem falsas.
- `scripts/keep-workflow-acceptance.py`: ensaio opt-in repetível com modelos PPTX construídos do zero. Copia apenas quatro ficheiros de código e um parágrafo de estilo comprovadamente vazio; não abre config/modelos clínicos originais. Fila, fichas e resultados são isolados. Gerador e PowerPoint são reais, não mocks.
- Testes adicionais de integridade de resultados, estados, restrição a dados fictícios e interface Electron.
- Servidor de ensaio do navegador atualizado para os recursos da cache. A autenticação permanece substituída por um stub nesse ensaio. A espera do service worker tem limite explícito para diagnosticar falhas.
- CI ampliada com testes Node de progresso e fila. `.runtime` e caches Python ficam fora do Git, sem apagar ficheiros existentes.

## Resultados observados no MSI

| Verificação | Resultado |
| --- | --- |
| Python | 80 executados: 79 aprovados, 1 omitido |
| Teste omitido | Ligações simbólicas indisponíveis nesta conta Windows |
| Estados/progresso Node | Aprovado |
| Fila/heartbeat isolados | Aprovado |
| Navegador | 20 verificações aprovadas, incluindo funcionamento offline |
| Independência da aplicação | Aprovada |
| Electron atual: envio, progresso, consulta e proteção das aprovações | Aprovado em perfil/HTML/fila de ensaio |
| Aceitação nativa: guia | Aprovada; 4 ficheiros verificados |
| Aceitação nativa: apresentação | Aprovada; 9 ficheiros verificados |
| Repetição da apresentação | Aprovada; todas as etapas concluídas reutilizadas |
| Sintaxe Python/JavaScript | Aprovada |

O teste nativo final foi repetido depois dos ajustes finais do verificador PPTX e da restrição explícita a dados fictícios. Evidência resumida: `docs/KEEP_NATIVE_ACCEPTANCE_20261101.json`.

Relatório completo final preservado no MSI: `.runtime/keep-mock-acceptance-46f8o2xq/acceptance-report.json`.

A primeira execução de CI de 6a3c8c6 revelou uma comparação demasiado estrita da grafia dos caminhos nativos Windows. A correção compara os ficheiros absolutos resolvidos, mantendo rejeição de caminhos relativos, ligações simbólicas, ficheiros trocados e ordem incorreta. Foram acrescentados quatro testes e repetidas as três execuções nativas com sucesso. Os relatórios de ensaios anteriores foram preservados.

Documentos/prévias em `runtime/KEEP ALIGNER GENERATOR/jobs/`, dentro da mesma pasta de ensaio: guia PPTX, comparação PPTX/PNG 3840×2160, PNG das duas páginas da guia, tabela fictícia, texto e prévia HTML. Não são modelos clínicos aprovados.

As três prévias de uma execução anterior equivalente (`keep-mock-acceptance-xyf9wqy6`) foram inspecionadas visualmente: texto legível sem cortes observados e oito posições de comparação. Não contêm anatomia real, odontograma clínico ou símbolos de attachments/IPR/elásticos. Não homologam esses elementos do modelo clínico oficial.

## Falhas intermédias resolvidas

A primeira preparação foi corretamente bloqueada por uma regra de isolamento do adaptador. A pasta de ensaio foi corrigida sem remover a regra. O teste do navegador falhou por recursos de cache não disponibilizados pelo servidor de ensaio; corrigiu-se o servidor e as 20 verificações passaram. Playwright foi utilizado a partir da instalação de desenvolvimento existente, sem alterar a aplicação instalada.

## Bloqueios ainda existentes

1. O módulo proposto `executor/workflow_contract.py`, destinado a associar antecipadamente todos os caminhos da ficha aos recursos exatos do manifesto, **não foi criado**: a ferramenta bloqueou a gravação por segurança. Não se contornou o bloqueio por outro conector. Esta associação completa continua por implementar/validar; por isso não se ativou o novo fluxo para casos reais.
2. My Keep/Hirsch/Onyx continuam simulados. Recolha autenticada, seleção inequívoca de caso/versão e capturas 3D anatómicas reais não foram implementadas ou aceites nesta sessão. Exigem ensaio autorizado de leitura, sem publicações.
3. Os modelos de aceitação foram construídos do zero, não são modelos clínicos oficiais. A validação de fidelidade gráfica clínica ainda é necessária.
4. Refinamento simples, idiomas e mecânicas não homologados no gerador não são abrangidos automaticamente por estes testes de guia/apresentação completa.
5. Windows 0.1.3 e executor de produção permanecem inalterados. Os testes não autorizam ativar o modo clínico, aprovar tratamentos ou publicar.

Nenhuma nota, autenticação, base Supabase, decisão de tratamento, ficheiro clínico ou backup foi alterado. Não houve acesso a pacientes, arquivo INFORME, envio/publicação My Keep, execução Codex ou acesso remoto ao POCO.

## Retoma

Inspecionar commits e estado local antes de alterar. Não usar reset/clean no worktree. Resolver primeiro a associação ficha/fontes e validar os conectores num caso de ensaio explicitamente autorizado. Só após aceitação técnica e visual do fluxo pretendido preparar atualização recuperável da instalação. Aprovação clínica e autorização de publicação são decisões humanas separadas.
