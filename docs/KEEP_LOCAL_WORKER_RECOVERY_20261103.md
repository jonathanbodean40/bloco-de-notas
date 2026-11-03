# KEEP ALIGNER — recuperação do executor e ensaio local de 2026-11-03

## Autorização e limites

O proprietário autorizou testes com casos reais, sem qualquer alteração em My Keep ou Hirsch Dynamics. Essa autorização foi usada para leitura de um caso local já preparado e testes numa cópia privada. Não autoriza aprovação clínica, publicação, arquivo em INFORME, substituição de guias entregues, alterações de tratamento ou divulgação de dados clínicos no GitHub.

Nenhum identificador de paciente, conteúdo clínico, fonte original ou documento de paciente deve ser adicionado a este repositório público.

## Executor instalado

A instalação estava parada e o último heartbeat era de 2026-11-02. Não existia uma tarefa de arranque do executor. A tarefa com nome semelhante pertencia ao PowerToys e foi preservada.

Após repetir os testes, foram instalados os quatro módulos do executor do commit 3005978, conservando o agent.py anterior numa subpasta de backup datada e verificando SHA-256 de cada ficheiro instalado. Notas, autenticação e versão da aplicação Windows não foram substituídas.

Foi registada a tarefa `KEEP ALIGNER Local Executor`:

- Executa o Python instalado e `agent.py serve --interval 8`, na sessão interativa do utilizador, com privilégios limitados e sem guardar palavras-passe.
- Tem um acionamento ao iniciar sessão e outro periódico de recuperação. A política IgnoreNew e o bloqueio singleton do executor impedem instâncias concorrentes.
- Tem tentativas de reinício após falha e não tem o limite de duração que terminaria um serviço saudável.
- Não altera configurações de rede, My Keep, Hirsch Dynamics, Supabase ou acesso ao POCO.

Instalador reproduzível: `scripts/install-local-worker.ps1`. Recusa instalação sobre tarefa existente, processo ativo ou fila não vazia. Preserva backups. Não deve ser executado novamente sem inspeção.

## Verificações efetivamente realizadas

- Testes Python: 80 executados, 79 aprovados e 1 omitido pela indisponibilidade de ligações simbólicas nesta conta.
- Testes Node de estados e fila isolada: aprovados; verificação de independência da aplicação: aprovada.
- Instalação conferida por SHA-256 e leitura do estado da tarefa.
- Paragem controlada com fila vazia e sem fichas clínicas preparadas no executor. A tarefa periódica voltou a iniciar o processo automaticamente, com novo PID e heartbeat atualizado.
- Pedido fictício enfileirado pela CLI instalada e processado pelo serviço efetivo. Resultado esperado `awaiting_case_data`, sem chamada ao gerador; fila voltou a zero e existia apenas uma instância do worker.
- Não foi reiniciado o Windows. O acionamento ao iniciar sessão está configurado, mas ainda não foi observado após um reinício físico.

## Ensaio com dados reais locais

A reconciliação dos ficheiros de IPR/auxiliares e da ficha existente passou. A guia existente passou 193 verificações estruturais, mas o PowerPoint reproduziu um alerta de texto fora da caixa na segunda página.

Foi criada uma cópia numa pasta privada de testes, fora do Dropbox e do repositório. Nessa cópia, o corpo do relatório passou de 14 para 12 pt, preservando títulos, parágrafos vazios, restante estrutura e todo o texto clínico. O novo resultado passou as mesmas 193 verificações e a renderização nativa das duas páginas apresentou zero alertas. As duas imagens foram inspecionadas.

Foram confirmados os hashes das fontes e da guia original após o ensaio. Não se modificou o original, não se alteraram decisões clínicas e não se arquivou a cópia em INFORME. O ajuste de tipografia desta cópia NÃO foi integrado como correção automática do gerador.

Os relatórios completos e cópias de teste permanecem apenas no MSI, na pasta privada KeepAligner_LocalTests. Este ensaio valida uma fotografia local dos dados, não a versão atualmente publicada nas plataformas.

## Limitações ainda abertas

O conector Browser recusou o acesso porque falta o contexto do navegador de origem nesta sessão. Não houve navegação autenticada, recolha online ou capturas 3D novas.

A gravação do novo módulo de autorização/associação ficha-fontes foi bloqueada pela ferramenta. A operação não foi repetida nem executada por outra via. O módulo não foi instalado e o bloqueio de geração automática para casos não fictícios foi mantido.

Assim, o arranque, recuperação e processamento da fila do executor estão operacionais e testados, mas a integração automática de casos reais a partir das plataformas ainda não está concluída. A autorização do proprietário já não é a pendência; permanecem a implementação técnica da associação e a validação das fontes online.
