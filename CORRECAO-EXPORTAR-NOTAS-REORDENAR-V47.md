# Bloco de Notas Pro — v47: exportação legível e ordenação
Data: 26/10/2026

## Objetivos
- Exportar manualmente apenas as notas escolhidas para qualquer pasta Dropbox.
- Abrir e ler as notas exportadas a partir da aplicação Dropbox no POCO F8 Ultra sem obrigar a compreender ficheiros .keepnote.json.
- Preservar links OnyxCeph e imagens, quando aplicável.
- Repor a ordenação por arrastar na página principal, no MSI e no POCO.

## Implementação
1. Novo botão «Exportar nota» na barra superior da nota, junto da nuvem.
2. No painel Dropbox, secção «Exportar nota para abrir no Dropbox», com formato Markdown (.md) ou HTML (.html).
3. Markdown é a opção inicial: o Dropbox Android suporta pré-visualização de ficheiros .md. Mantém o texto e links em formato Markdown; imagens inseridas na nota permanecem acessíveis pela ligação ao original.
4. HTML é uma cópia independente para abrir no navegador, com texto formatado, hiperligações e imagens incorporadas. O Dropbox não garante pré-visualização direta dos .html: no POCO poderá ser necessário «Abrir com» navegador.
5. Escolha manual da pasta no campo Dropbox que já existia, incluindo pastas aninhadas novas. A exportação cria a pasta se necessário.
6. Reexportar no mesmo caminho exige controlo de revisão do Dropbox (CAS). Nunca há substituição silenciosa de ficheiros existentes ou interferência com o índice central do Dropbox.
7. «Descarregar nota» permite guardar o mesmo ficheiro no próprio dispositivo.
8. Novo botão de arrastar na base direita de cada nota na página principal. Funciona com o rato (botão esquerdo premido sobre o ícone ou botão direito sobre a nota) e por arrastamento sobre o ícone no ecrã táctil.
9. A ordem fica guardada localmente por dispositivo, sem alterar conteúdos nem forçar uma ordem idêntica no MSI e POCO.
10. A autenticação, cópias e sincronização do Dropbox, Supabase e editor mantêm-se inalterados.

## Segurança e limitações
- Exportação apenas por comando manual; não executa uma migração de notas.
- A versão de consulta exportada pode conter links privados e informação do utilizador. Guardar numa pasta privada do Dropbox; não criar links públicos sem revisão.
- O link exportado do OnyxCeph não ganha validade adicional com a exportação. Para permanência, usar Keep Links.
- Não se pode garantir que a pré-visualização Markdown no Dropbox do POCO torna todas as ligações clicáveis sem um teste real naquele dispositivo. A cópia HTML oferece outra forma de abrir os links.
- O HTML exportado aplica higienização de elementos e protocolo de URL e política CSP para impedir scripts.

## Testes
- Testes de integração de navegador em ambiente isolado: exportar .md e .html, pasta arbitrária, controlo de revisão, sem duplicados e sem alteração da nota técnica.
- Testes OnyxCeph: hiperligações e imagens preservadas no HTML, links no Markdown e scripts bloqueados.
- Ordenação por botão direito, pega com rato, pega com ponteiro táctil simulado; persistência da ordem e ausência de alteração de conteúdo.
- Testes KEEP ALIGNER e controlo de acesso preservados.

## Backups
- Código anterior: C:\Users\ferna\Documents\BlocoNotasPro_BACKUP_ANTES_EXPORTAR_E_ORDENAR_20261026.zip
- Dados antes da v47: C:\Users\ferna\Documents\BlocoNotasPro_DADOS_ANTES_V47_20261026.zip

## Seguimento recomendado
- Confirmar pré-visualização/abertura real de uma nota .md no POCO e os links OnyxCeph.
- Confirmar gesto de ordenação com o dedo no POCO.
