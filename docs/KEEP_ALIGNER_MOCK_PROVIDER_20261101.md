# KEEP ALIGNER — adaptador fictício de fontes (01/11/2026)

## Objetivo e âmbito

`executor/mock_provider_adapter.py` é um **contrato de integração experimental, exclusivamente offline e de leitura**, destinado a testar a agregação e a rastreabilidade de exportações representativas dos três sistemas: My Keep, Hirsch Dynamics e OnyxCeph. **Não efetua login, leitura autenticada, captura de ecrã, recolha de pacientes ou comunicação de rede.** Os nomes dos fornecedores apenas identificam formatos de ensaio simulados. Não existe ligação direta a My Keep, Hirsch ou Onyx.

O adaptador não escreve ficheiros e não invoca o gerador clínico. Devolve apenas em memória um manifesto compatível com o validador `source_preflight.py`. Na CLI imprime somente contagens e estados técnicos, sem nomes, identificadores de casos ou caminhos. Não produz apresentação nem guia clínica.

## Convenções de segurança

- Pasta de entrada obrigatoriamente isolada, com nome começado por `keep-mock-`; recusa caminhos sob `Dropbox`, `KeepAligner`, `patients` ou `pacientes`.
- Apenas `exports/MyKeep.json`, `exports/HirschDynamics.json` e `exports/OnyxCeph.json` são aceites; não é permitido indicar URLs.
- Cada exportação exige `schema_version: 1`, `synthetic_only: true`, `case_token` e `plan_id` com prefixo `SYNTHETIC-`, fornecedor exato, e listas `captures` e `sources`. São rejeitados campos adicionais, incluindo campos de credenciais.
- Todas as exportações da mesma execução devem ter **o mesmo caso e a mesma versão**. Os nomes dos fornecedores não constituem prova de proveniência real.
- Cada recurso é confinado à pasta de ensaio; referências relativas com `..`, ligações simbólicas e ficheiros acima do tamanho máximo são rejeitados.
- Fontes tabulares e a tabela de movimentos são aceites apenas no mock OnyxCeph. Capturas são aceites nos mocks MyKeep/HirschDynamics. O adaptador calcula SHA-256 dos recursos locais. A validação de conteúdo e coerência passa pelo `source_preflight.py` existente.
- A CLI devolve sempre `writesPerformed: false`, `clinicalApproval: false` e `publishingAuthorized: false`; erros são genéricos para não divulgar dados sensíveis.
- Não há alterações ao executor instalado, à aplicação Windows 0.1.3, ao Supabase, a notas ou a pastas clínicas.

## Estrutura do ensaio

Num diretório temporário, por exemplo `keep-mock-1234`:

```text
keep-mock-1234/
  exports/
    MyKeep.json
    HirschDynamics.json
    OnyxCeph.json
  assets/
    initial-front.png
    ...
    final-lower.png
    movement.png
```

Cada ficheiro JSON contém apenas metadados **inventados** deste formato:

```json
{
  "schema_version": 1,
  "synthetic_only": true,
  "case_token": "SYNTHETIC-CASE01",
  "plan_id": "SYNTHETIC-V1",
  "provider": "MyKeep",
  "captures": [],
  "sources": []
}
```

No mock HirschDynamics, cada entrada de `captures` contém apenas: `path`, `phase` (`initial`/`final`), `view` (`front`/`lateral`/`upper`/`lower`), `contacts_off`, `orientation_ref` e `scale_ref`. No mock OnyxCeph, cada entrada de `sources` contém `path` e `kind` (`movement_table`, `ipr_csv`, `attachments_csv`). O teste preenche automaticamente essas entradas com recursos criados no diretório temporário.

## Comandos de teste (apenas desenvolvimento)

Na raiz do repositório:

```powershell
python -m unittest discover -s tests -p test_mock_provider_adapter.py -v
python -m unittest discover -s tests -p test_source_preflight.py -v
node tests/keep-local-executor.test.cjs
npm run test:independence
```

Para inspeção de um pacote fictício criado separadamente:

```powershell
python executor/mock_provider_adapter.py --mock-root C:\Temp\keep-mock-1234 --provider MyKeep --provider HirschDynamics --provider OnyxCeph --package-type full_presentation
```

**Resultados locais no MSI, 01/11/2026:** 13 testes novos do adaptador + 16 testes existentes de pré-validação aprovados; teste isolado do executor aprovado; `npm run test:independence` aprovado; compilação sintática do módulo aprovada. Não foram utilizados dados clínicos reais.

## Próximos passos e aprovação

1. Definir integrações **autenticadas e limitadas a leitura**, com permissões e identificadores reais explicitamente autorizados, mantendo logs livres de credenciais.
2. Criar um mecanismo de exportação/captura 3D independente do mock e confirmar orientação, escala e contactos oclusais por inspeção visual.
3. Validar identidade do paciente, versão, staging, IPR, attachments, botões e elásticos contra o plano clínico aprovado, usando FDI. O SHA-256 não prova correção clínica.
4. Só depois ligar os dados ao gerador em ambiente controlado e executar um teste real com revisão do ortodontista. Publicação, alterações de tratamento e arquivo em INFORME permanecem bloqueados sem aprovação explícita.

**Estado do componente:** funcional como interface de simulação; indisponível para recolha real ou geração autónoma.