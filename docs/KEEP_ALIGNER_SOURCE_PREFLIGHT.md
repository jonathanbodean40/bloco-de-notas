# KEEP ALIGNER — contrato de pré-validação de fontes (desenvolvimento)

Estado: **experimental, sem acesso automático às plataformas nem autorização clínica.**

Os ficheiros são colocados manualmente numa pasta de ensaio isolada. O validador offline `executor/source_preflight.py` recebe o caminho para um `manifest.json` com `schema_version: 1`, `plan_id`, `package_type`, `captures` e `sources`. A execução não usa credenciais, não inicia sessões, não efetua uploads e não escreve em pastas de pacientes.

- `package_type`: `guide`, `full_presentation` ou `refinement_simple`.
- `sources`: exportações `ipr_csv`, `attachments_csv` e `movement_table` já guardadas, com `provider: OnyxCeph`, `plan_id`, `path` relativo e `sha256`.
- `captures`: na apresentação completa são oito PNG na ordem `initial`/ `final` × `front`, `lateral`, `upper`, `lower`, com `provider`, `plan_id`, `path`, `sha256`, `contacts_off: true`, `orientation_ref` e `scale_ref`.

O validador confere caminhos confinados à pasta de ensaio, hashes, dimensões, ordem das vistas, consistência da versão e referências de orientação e escala. **Não comprova** que o mapa de contactos está realmente desligado; apenas verifica a declaração. Também não confirma correção clínica, identidade, origem remota autêntica, qualidade das capturas, escala física, objetivos, attachments, IPR, nem autorização para publicação.

Teste apenas com dados fictícios: `python -m unittest discover -s tests -p test_source_preflight.py`. Não usar documentação ou dados reais para testes automatizados. O validador ainda não está ligado ao executor em produção; não alterar o gerador clínico ou o Bloco de Notas Pro sem homologação e testes adicionais.


## Porta de segurança do executor (desenvolvimento, 01/11/2026)

O `executor/agent.py` só avança para o gerador, quando existir uma ficha previamente estruturada, **se a respetiva pasta de staging** `LocalAgent/cases/<referencia>/manifest.json` passar no `source_preflight.py`. A referência é limitada a um código simples (nunca um caminho ou URL). O manifesto tem de declarar a mesma versão que `request.version`, conter um tipo compatível com o pedido (`guide` ou `full_presentation`) e pelo menos **uma fonte verificada**. As fontes estão confinadas à pasta do caso; não basta uma ficha JSON isolada nem um manifesto vazio.

Um pedido sem manifesto válido recebe o estado `awaiting_verified_sources`, sem chamar o gerador. O manifesto e o campo de versão não substituem a confirmação da identidade do paciente nem uma autorização clínica. A validação é **offline**, usando material já exportado; não lê automaticamente My Keep, Hirsch ou Onyx e não verifica valores clínicos. Ainda não se deve usar este código como produção: o worker instalado é anterior a esta alteração, e um futuro instalador terá de distribuir **ambos** `agent.py` e `source_preflight.py` de forma controlada e testada. Não alterar a aplicação ou os dados do utilizador por causa deste protótipo.

Testes com fontes sintéticas: `python -m unittest discover -s tests -p 'test_*.py' -v`. O ficheiro `test_agent_source_gate.py` utiliza sempre diretórios temporários e injeta um gerador fictício quando necessário. Não executa o gerador real nem altera a fila clínica. No MSI, 8 testes da porta de segurança foram executados com 7 sucessos e 1 omitido por falta de permissão para ligações simbólicas; a verificação de sintaxe Python passou. A execução do GitHub Actions deve ser observada separadamente após os commits.

## Robustez da proveniência (01/11/2026 — desenvolvimento)

O validador da versão de manifesto `schema_version: 1` agora rejeita:
- propriedades não previstas no manifesto, nas fontes e nas capturas (incluindo dados de sessões ou credenciais);
- chaves JSON repetidas, que tornariam ambígua a interpretação da versão;
- utilização do mesmo caminho relativo por mais de uma fonte/captura, incluindo diferenças apenas de maiúsculas/minúsculas em Windows.

Essas verificações não demonstram que duas imagens diferentes sejam visualmente corretas. Dois ficheiros distintos podem conter o mesmo desenho; o SHA-256 prova a integridade dos bytes, não a identidade nem a qualidade da informação clínica. A revisão visual e clínica permanece obrigatória. A alteração está apenas no ramo de desenvolvimento; não instalar nem sincronizar automaticamente com o worker em produção sem teste de compatibilidade e revisão humana.
