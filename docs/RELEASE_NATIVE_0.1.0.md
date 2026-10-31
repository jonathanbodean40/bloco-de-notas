# Bloco de Notas Pro — release nativa 0.1.0

## Entrega técnica

- **Windows**: instalador Electron/NSIS com atalhos do menu Iniciar; instalado e confirmado no MSI Windows 11 (saída do instalador 0). Testes sintéticos reais de arranque e exportação HTML com formatação e imagem embutida passaram. O instalador ainda não tem certificado de editor de código.
- **Android**: APK release construído em GitHub Actions, alinhado e **assinado no MSI** com uma chave de distribuição persistente (PKCS12/RSA 3072), protegida por palavra-passe DPAPI do utilizador Windows. Os esquemas v1, v2 e v3 foram verificados pelo apksigner.
- **Distribuição Android**: ramo `distribution/android`, ficheiro `releases/BlocoNotasPro-Android-0.1.0.apk`.
- **SHA256 APK assinado**: `88483A249E3F805448EFB3190634D22D23849FC6804F642A27C629CBAE567BA7`.
- **Certificado de assinatura SHA256**: `C2E06F647F606F3D7CEEFD9EEFB8DB3C367353861C0B7B89F339D178FEE9F1BA`.

## Independência

O executável não precisa do ChatGPT, Codex ou Dropbox para abrir, guardar ou sincronizar. O Supabase é o único backend online de autenticação e notas; o cache local permite edição em situações offline previamente autorizadas. A partilha para Dropbox, WhatsApp ou Gmail é estritamente manual. No Windows, a nota completa é exportada em HTML por janela nativa Guardar como; no Android, o plugin KeepSharePlugin encaminha diretamente a aplicação quando instalada, com fallback para a folha de partilha.

## Dados e preservação

Não houve alteração nem apagamento de notas na cloud ou de ficheiros dos perfis de navegador. A versão Web/PWA original não foi substituída. Os dados locais não migram automaticamente entre origens; o sistema deve recuperar notas sincronizadas no Supabase com o mesmo utilizador e verificar alterações locais pendentes antes de mudar.

## Limitações confirmadas, não ocultar em entregas

A configuração pública Supabase Auth continua a indicar **Google OAuth desativado**. Foram implementados fluxo PKCE/deep link, botão Google e associação de identidade, mas a ativação em produção requer cliente OAuth Google Cloud e respetivo segredo configurados no Supabase (e URL de retorno autorizada). O conector Supabase disponível não fornece escrita para esta configuração.

Os testes foram executados com dados sintéticos. Ainda não houve validação da instalação no POCO F8 Ultra, nem login real Google ou avaliação de todas as notas clínicas sincronizadas. Não declarar estes testes como executados.

## Evolução e assinatura

Para assinar novas versões Android, obter um APK release não assinado, guardar o ficheiro no MSI e executar `scripts/sign-android-release.ps1` com `-InputApk` e `-OutputApk`. A chave e o ficheiro de palavra-passe DPAPI permanecem em `%LOCALAPPDATA%\KeepAligner\AndroidSigning`, nunca no repositório ou no ChatGPT. **Fazer cópia segura da chave** é importante: sem ela, atualizações compatíveis não poderão ser produzidas após perder o MSI.
