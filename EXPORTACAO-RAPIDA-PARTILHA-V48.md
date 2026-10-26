# Bloco de Notas Pro — exportação rápida e partilha, versão v48
Data: 26/10/2026

## Objetivo
Eliminar o percurso longo de «Ligar Dropbox» e abrir o painel técnico sempre que se pretende exportar uma nota.
O ícone de exportar deve abrir a navegação de pastas a partir da raiz do Dropbox, com opções nativas de partilha Android para WhatsApp, email, Dropbox (se aparecer no sistema) e outras aplicações.

## Funcionamento implementado
- Ícone «Exportar nota» da barra da nota abre um novo diálogo rápido, sem mostrar as opções técnicas do Dropbox.
- Apresenta a lista de pastas a partir da raiz da conta autorizada via API Dropbox, permite navegar, voltar, atualizar e criar pastas.
- «Guardar nesta pasta» exporta uma cópia legível por escolha explícita: Markdown (.md), texto simples (.txt) ou HTML (.html).
- Markdown preserva os links e inclui uma ligação de edição do original no Bloco de Notas Pro autenticado.
- TXT permite edição num editor de texto compatível, com link de retorno ao original. Alterações a este ficheiro externo NÃO atualizam automaticamente a nota canónica.
- HTML preserva mais formatação e imagens, com sanitização e CSP; abrir pode exigir um navegador externo.
- «WhatsApp, email e outras aplicações» chama a partilha nativa do sistema com o texto e ligação da nota.
- «Enviar ficheiro» chama a partilha nativa com um ficheiro .md, .txt ou .html. As aplicações disponíveis dependem da configuração Android/Windows e do formato.
- «Guardar no dispositivo» descarrega o mesmo ficheiro.
- Se a partilha não for suportada, apresenta alternativa de cópia de texto ou download.
- A ligação Dropbox é recuperada automaticamente do cofre cifrado IndexedDB sempre que disponível, sem autorização repetida.
- Bloqueios temporários da sessão pessoal suspendem o token de sessão, mas não eliminam o token persistente.
- Apenas o botão «Desligar Dropbox» apaga a autorização persistente do navegador.
- Compatibilidade corrigida entre tokens antigos e formato do refresh token do cofre.
- Em colisão de ficheiros sem revisão local conhecida, a aplicação compara o ficheiro existente e pede confirmação expressa antes de atualizar por CAS. Não sobrescreve silenciosamente alterações.
- A exportação NÃO altera o índice central das notas nem elimina ficheiros.

## Limites explícitos
- Não é possível garantir que tocar num ficheiro Markdown/HTML dentro da aplicação Dropbox abra imediatamente o editor rico do Bloco de Notas Pro: o Dropbox controla as associações de ficheiros no Android.
- A solução inclui um link para abrir e editar a nota original autenticada. Os ficheiros .md e .txt podem ser editados em editores externos compatíveis, mas são cópias independentes.
- A seleção de pastas abre dentro da aplicação, a partir da raiz real do Dropbox, sem enviar o ficheiro para um endereço público temporário.
- A partilha nativa Android requer suporte de Web Share API e uma ação direta do utilizador.
- O WhatsApp e aplicações externas apenas recebem o conteúdo depois de o utilizador escolher a ação de partilhar.
- Não são publicadas ligações públicas ao Dropbox por esta funcionalidade.

## Validação
- 56 testes automatizados Node/Playwright e 175 verificações no navegador, todos aprovados no MSI.
- Testes de gravação em pasta arbitrária, navegação pela raiz Dropbox, ficheiro editável .txt, link para editor da nota original, partilha nativa simulada, duplicados, revisões e preservação do ficheiro canónico.
- Testes de recuperação OAuth encriptado após suspender a sessão e formato de token corrigido.
- Testes de regressão dos componentes KEEP ALIGNER e das notas existentes.
- Testes com dados fictícios, sem exportar qualquer nota real.
- Não testado ainda numa sessão real do POCO F8 Ultra: destinos efetivamente mostrados no menu de partilha Android e comportamento «Abrir com» de ficheiros .md/.txt.

## Backups prévios
- Código: C:\Users\ferna\Documents\BlocoNotasPro_CODIGO_ANTES_EXPORTACAO_RAPIDA_V48_20261026.zip
- Dados: C:\Users\ferna\Documents\BlocoNotasPro_DADOS_ANTES_EXPORTACAO_RAPIDA_V48_20261026.zip
- 53 ficheiros conferidos com SHA-256 antes da publicação.
