# KEEP ALIGNER — integração local e limites de segurança (01/11/2026)

## Alterações de desenvolvimento verificadas
- `tests/keep-local-executor.test.cjs`: cria `LOCALAPPDATA` temporário exclusivo. O comando `once` deixa de poder processar pedidos que estejam na fila real do MSI durante os testes.
- `tests/keep-electron-ipc-smoke.cjs`: abre Electron com perfil e `LOCALAPPDATA` temporários e executa o worker uma vez, apenas sobre um pedido sintético. Não elimina resultados da fila real.
- `executor/agent.py health`: expõe `workerOnline`, `workerLastSeenAt`, `workerHeartbeatAgeSeconds`, `queueDepth` e `resultCount`. Os contadores leem apenas metadados dos diretórios, sem abrir fichas clínicas ou resultados.
- O estado `ready` exige o Python do gerador disponível **e** um heartbeat do worker recente (até 60 segundos). Isto prova atividade técnica, não validade clínica.

## Verificações realizadas
Executar na raiz do repositório de desenvolvimento:
```powershell
node tests/keep-local-executor.test.cjs
node tests/keep-electron-ipc-smoke.cjs
npm run test:independence
python -m py_compile executor/agent.py
```
Os testes sintéticos exercitam enfileiramento, execução e resposta `awaiting_case_data`. Não geram nem publicam um plano clínico real.

## Estado e fronteiras
- Operacional: fila local Windows, validação de pedidos, worker determinístico, geração apenas com ficha estruturada previamente disponível, consulta de saúde/heartbeat.
- Não operacional ou não validado: integração de leitura autenticada de My Keep, Hirsch/Onyx, recolha automática de 3D, verificação de imagens e fontes contra o paciente, aplicação de aprovações clínicas e arquivamento automático em INFORME.
- O Codex CLI pode estar instalado sem ser invocado pelo worker. `automaticCodexCalls: false` é intencional. Nenhum input da UI pode ser usado como comando de shell.
- O worker **não publica**, **não arquiva** nem altera estados no My Keep. Um resultado `awaiting_visual_review` exige revisão visual e clínica humana, e não equivale a autorização de utilização.

## Próximos passos antes de produção
1. Desenhar interfaces de **leitura autorizada** para as fontes (ID, versão, data, permissões e rastreabilidade), inicialmente com mocks, sem credenciais em logs.
2. Validar um pacote de dados fictício ponta a ponta e conferir exportações de imagens apenas com assets aprovados.
3. Implementar acompanhamento de estado na UI que distinga fila, worker parado, dados em falta e revisão pendente.
4. Confirmar com o utilizador a autorização necessária para um teste real controlado; nunca assumir publicação ou alteração de tratamentos.
5. Fazer revisão visual e clínica com FDI e regras KEEP ALIGNER antes de qualquer arquivo em INFORME.

A versão Windows instalada não é alterada por estas edições de código; requer compilação, ensaio e aprovação separados.


## Fortalecimento do preflight de exportações CSV (01/11/2026)
- `executor/source_preflight.py` confirma agora, além da extensão e do SHA-256, que os CSV `ipr_csv` e `attachments_csv` incluem um cabeçalho legível em UTF-8 (incluindo BOM opcional), não vazio e dentro de limites explícitos. CSV de zero bytes, codificação inválida e cabeçalhos vazios são rejeitados como evidência.
- A verificação lê apenas o cabeçalho; **não valida valores clínicos, numeração FDI, etapas de IPR ou posições de attachments**. Um resultado `ok=true` significa somente integridade e formato da fonte, não prontidão clínica ou autorização para arquivo.
- No MSI, `python -m unittest discover -s ...\\tests -p test_source_preflight.py -v` passou **16 testes fictícios** após a alteração (12 anteriores e 4 novos). O executor isolado e `npm run test:independence` também passaram.
- Commits do ramo de desenvolvimento: `864e564d` (validador) e `2923e776` (testes). O ficheiro local do validador ainda é experimental; a instalação Windows 0.1.3 não foi substituída e as fontes clínicas reais continuam excluídas.
- A integração com My Keep/Hirsch/Onyx, a verificação visual dos contactos oclusais e a identidade do caso permanecem **não validadas**.
