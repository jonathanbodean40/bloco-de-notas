# Bloco de Notas Pro — migração autónoma (trabalho em curso)

Objetivo: aplicação Windows (.exe) e Android (.apk), sem ChatGPT/Codex nem Dropbox como armazenamento. Supabase permanece como backend de autenticação e sincronização; Dropbox, WhatsApp e Gmail apenas para partilha manual.

## Adicionado nesta ramificação
- Wrapper Electron para Windows com assets empacotados e sem acesso Node no renderer.
- Estrutura Capacitor para Android com assets locais. Gerar a plataforma com `npx cap add android` (primeira vez), depois `npm run android:sync` e compilar APK via Android Studio/Gradle.
- Scripts de preparação do frontend e verificação estática de independência.
- Nenhuma alteração às tabelas ou às notas na cloud; não houve migração de dados.

## Limites / bloqueios reais
1. **Não publicar instaladores como produção ainda.** O projeto original guarda notas em localStorage por origem web. O domínio nativo `notas://app` no Windows e o domínio interno Capacitor no Android criam armazenamento diferente do browser original. Fazer migração de notas e teste de sincronização **antes** de substituir uma instalação existente.
2. O gate `personal_app_access` requer conectividade Supabase para abrir notas; offline após novo arranque não é ainda suportado. Alterar apenas após desenhar cache de sessão seguro e testar revogação de dispositivos.
3. OAuth Google exige configurar Google no Supabase, URI de redirecionamento e retorno seguro a ambas aplicações. A interface deverá existir, mas não considerar login validado antes de testar Google, email/password e ligação de identidade com a mesma conta.
4. O código atual limita três sessões/dispositivos no Supabase; evitar criar várias instalações de teste indiscriminadamente.
5. Não armazenar quaisquer chaves service_role no cliente; publishable key pode integrar o bundle, protegendo acesso com RLS.
6. Assinar APK com keystore privada e manter a mesma chave nas atualizações. Para Windows, testar instalador/assinatura; sistema pode avisar sobre editor desconhecido.
7. A integração nativa Android/Windows com canais externos de partilha deve ser testada antes de marcar exportação como concluída.
8. GitHub não é ambiente de teste de Windows/Android. Validar no MSI e POCO F8 Ultra, com cópias de segurança verificadas antes da migração.

## Comandos (num ambiente Node/Android SDK)
```sh
npm install
npm run test:independence
npm run desktop
npm run build:windows
npx cap add android
npm run android:sync
npm run android:open
```

Estado: **estrutura de empacotamento inicial**, não instaladores assinados nem funcionamento offline validado.
