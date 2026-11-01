# KEEP ALIGNER — contrato de pré-validação de fontes (desenvolvimento)

Estado: **experimental, sem acesso automático às plataformas nem autorização clínica.**

Os ficheiros são colocados manualmente numa pasta de ensaio isolada. O validador offline `executor/source_preflight.py` recebe o caminho para um `manifest.json` com `schema_version: 1`, `plan_id`, `package_type`, `captures` e `sources`. A execução não usa credenciais, não inicia sessões, não efetua uploads e não escreve em pastas de pacientes.

- `package_type`: `guide`, `full_presentation` ou `refinement_simple`.
- `sources`: exportações `ipr_csv`, `attachments_csv` e `movement_table` já guardadas, com `provider: OnyxCeph`, `plan_id`, `path` relativo e `sha256`.
- `captures`: na apresentação completa são oito PNG na ordem `initial`/ `final` × `front`, `lateral`, `upper`, `lower`, com `provider`, `plan_id`, `path`, `sha256`, `contacts_off: true`, `orientation_ref` e `scale_ref`.

O validador confere caminhos confinados à pasta de ensaio, hashes, dimensões, ordem das vistas, consistência da versão e referências de orientação e escala. **Não comprova** que o mapa de contactos está realmente desligado; apenas verifica a declaração. Também não confirma correção clínica, identidade, origem remota autêntica, qualidade das capturas, escala física, objetivos, attachments, IPR, nem autorização para publicação.

Teste apenas com dados fictícios: `python -m unittest discover -s tests -p test_source_preflight.py`. Não usar documentação ou dados reais para testes automatizados. O validador ainda não está ligado ao executor em produção; não alterar o gerador clínico ou o Bloco de Notas Pro sem homologação e testes adicionais.
