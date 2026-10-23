# Bloco de Notas Pro — implementação Dropbox (23-10-2026)

## Implementação na branch de desenvolvimento
- Armazenamento local-first: notas são escritas primeiro no dispositivo, e posteriormente sincronizadas.
- Motor Dropbox com índice central de IDs e caminhos, um ficheiro versionado por nota.
- Upload condicional com controlo de revisão e deteção de conflitos (nunca substitui versões divergentes automaticamente).
- Migração explícita das notas existentes com verificação prévia da sincronização atual Supabase.
- Recuperação de notas noutro dispositivo, atualização de notas existentes e eliminação lógica recuperável.
- Navegação por pastas e importação sem substituição; seleção manual da pasta de uma nota.
- Supabase continua como cópia adicional, sem eliminar dados já existentes.
- OAuth PKCE com refresh token encriptado no IndexedDB quando suportado pelo navegador; botão para desligar a ligação.
- Abertura direta de uma nota através da navegação de pastas DENTRO do Bloco de Notas Pro. Não é garantido clique no ficheiro nativo da aplicação Dropbox.

## Validação concluída com dados sintéticos
- 19 testes automáticos Node: aprovados.
- 10 cenários Playwright e 124 verificações: aprovados.
- Abrir, editar e importar notas reais do utilizador: não testado.
- OAuth real e aplicações PC MSI / POCO F8 Ultra: ainda não validados.

## Bloqueios para a ativação final
1. Criar ou localizar uma Dropbox API App, com acesso Full Dropbox e OAuth Redirect URI https://jonathanbodean40.github.io/bloco-de-notas/
2. Autorizar essa aplicação na conta Dropbox correta (App Key pública na interface; NUNCA o App secret).
3. Testar com notas fictícias nos dois dispositivos; validar abertura, edições concorrentes, reconexão, trabalho offline e recuperação.
4. Após validação, publicar a versão e ativar Dropbox como principal a partir da interface. Não substituir dados reais automaticamente.
5. Confirmar suporte externo a ficheiros no Android: a app Dropbox pode não abrir .keepnote.json no editor com um único toque.

## Segurança
- Nenhuma nota real foi lida, modificada ou migrada nesta implementação.
- Nenhuma credencial Dropbox real foi usada nem gravada no código.
- Não foi publicada alteração da aplicação pública.
- Preservar cópia de segurança original antes de qualquer implementação definitiva.
- O armazenamento cifrado no navegador não protege contra código malicioso da mesma origem; considerar vault do lado servidor em contexto mais sensível.

## Pastas no MSI
- Desenvolvimento: C:\Users\ferna\Documents\BlocoNotasPro_Dropbox_Desenvolvimento_20261023
- Backup do código anterior: C:\Users\ferna\Documents\BlocoNotasPro_Backup_Codigo_AntesAlteracoes_20261023
- Protótipo da etapa anterior: C:\Users\ferna\Documents\BlocoNotasPro_Prototipo_Validado_20261023

## Comandos de validação
node --test tests\dropbox-primary.test.cjs tests\dropbox-storage.test.cjs tests\dropbox-ui.test.cjs tests\dropbox-oauth.test.cjs tests\private-access.test.cjs
node tests\startup-browser.cjs (com PLAYWRIGHT_MODULE definido)
