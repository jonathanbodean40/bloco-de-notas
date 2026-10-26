# Bloco de Notas Pro — interface única de partilha (v49)
Data: 26/10/2026

## Objetivo
Substituir o ícone da nuvem e o antigo ícone Exportar por um único ícone Partilhar na barra superior de cada nota. O menu normal apresenta exatamente três destinos: Dropbox, WhatsApp e Gmail.

## Comportamento
- Ícone Partilhar abre um diálogo pequeno, apenas com Dropbox, WhatsApp e Gmail.
- Dropbox: copia a ligação privada e editável da nota original e abre dropbox.com. O utilizador escolhe a pasta, clica Criar → Mais → Atalho, cola a ligação e guarda. Não afirma ter guardado automaticamente o atalho, pois a API do Dropbox não cria atalhos .web.
- WhatsApp: abre a interface WhatsApp com o título e a ligação direta da nota.
- Gmail: abre a composição do Gmail com título e ligação direta.
- Quem abrir a nota original mantém design e ferramentas de edição, desde que esteja autenticado na conta autorizada do Bloco de Notas Pro.
- As notas e respetivas alterações continuam a sincronizar pelo armazenamento configurado (Dropbox principal/local e Supabase adicional).
- O antigo botão Dropbox do rodapé permanece no DOM apenas como ferramenta interna, mas oculto visualmente; o antigo diálogo de exportação técnica deixa de ser acessível pela interface normal.
- Não apagámos os mecanismos anteriores de recuperação/sincronização, porque são necessários para preservar as notas existentes.
- Não há criação de ficheiros Markdown, HTML, TXT, JSON ou atalhos falsos a partir do novo menu.
- A partilha de uma ligação é um ato explícito do utilizador. Uma pessoa sem acesso autorizado à conta não consegue editar ou visualizar a nota apenas com a ligação.

## Limites técnicos
- O Dropbox suporta atalhos .web criados no website e abertos na aplicação móvel; a API pública não os cria. Não se deve carregar um .web fictício por upload como se fosse um atalho funcional.
- Em telemóvel o WhatsApp e Gmail poderão abrir a app instalada ou o navegador, dependendo das associações de links.
- Não é possível permitir edição no Bloco de Notas Pro a terceiros sem implementar um sistema de permissões próprio, fora do objetivo atual.
- O Dropbox e os clientes podem exigir autenticação nos seus próprios serviços.

## Validação
- 56 testes automáticos Node, incluindo funcionalidades Keep Aligner, OAuth, notas e Dropbox: aprovados.
- 11 cenários de browser e 181 verificações com dados sintéticos: aprovados.
- Verificações de interface: apenas um ícone de partilha, exatamente três opções, nenhum acesso ao painel técnico na utilização normal.
- Verificações de links: diretos para a nota original; ações Dropbox/WhatsApp/Gmail; sem alterações automáticas das notas.
- O teste anterior mantém a sincronização pelo Dropbox independente do menu visual.
- Verificação real de toque no POCO pendente após publicação.

## Recuperação
- Código antes da alteração: C:\Users\ferna\Documents\BlocoNotasPro_CODIGO_ANTES_BOTAO_PARTILHAR_20261026.zip
- A versão anterior permanece num commit GitHub, com possibilidade de reversão.
