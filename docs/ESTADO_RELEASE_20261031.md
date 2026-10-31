# Estado da versão autónoma — 31/10/2026

## Verificado
- O código da aplicação não depende do ChatGPT/Codex para abrir e editar notas. Supabase continua a tratar login e sincronização.
- Dropbox não participa no armazenamento e não há chamadas Dropbox API na aplicação em execução. Exportar para Dropbox é uma ação manual (partilha de ficheiro / transferência local e upload manual).
- Instalador Windows NSIS compilado no MSI e em GitHub Actions.
- APK de **depuração** Android compilado em GitHub Actions.
- Teste real de abertura Electron em perfil temporário: título, ecrã de login, botão Google, origem `notas://app`, sem erro JS inicial registado.
- Teste sintético Electron do menu Exportar: Dropbox, WhatsApp, Gmail e Copiar texto.
- Supabase `public.notes` mantém RLS ativa. Não houve alterações à base de dados nem migração real nesta entrega.
- A versão PWA/produção e todas as notas permanecem inalteradas.

## Pendências que impedem declarar a aplicação concluída para produção
1. **Google OAuth está desativado no Supabase**. Configurar credenciais Google e allowlist; confirmar que a conta Google se liga ao utilizador Supabase existente, sem criar proprietário novo.
2. **Verificar login real + sincronização PC/Android**, incluindo limite de três dispositivos da RPC `personal_app_access`, importação de notas antigas, imagens e edição simultânea.
3. **Assinatura de produção.** O EXE não tem assinatura de editor e o APK está assinado para depuração (não distribuir como versão de produção nem confiar em atualizações assinadas por runners diferentes).
4. **Testar no POCO F8 Ultra**: OAuth deep-link, partilha/Dropbox, WhatsApp, Gmail, clipboard, reinstalação e permissões Android.
5. **Offline após reiniciar** não está validado: o controlo `personal_app_access` requer ligação online no arranque. Requer desenho de cache seguro compatível com revogação.
6. **Rever UX de exportação no Android**, em especial suporte de partilha de ficheiros no WebView.
7. Testar instalador/desinstalador em Windows sem perda de notas antes de substituir a aplicação web existente.

## Artefactos de teste
- Windows: `Bloco de Notas Pro Setup 0.1.0.exe`
- Android: `app-debug.apk`

Os artefactos estão na execução Actions da ramificação `feature/independent-windows-android`; cópias de teste também podem ter sido disponibilizadas na conversa ChatGPT. Não disponibilizar como produção.

## Fontes
- Código e configurações: esta ramificação.
- Google OAuth: `docs/GOOGLE_LOGIN_SETUP.md`.
- Build: `.github/workflows/build-native.yml`.
- Embalagem: `docs/INDEPENDENCIA_E_INSTALADORES.md`.

**Regra de segurança:** não alterar, fundir ou apagar notas existentes durante a instalação; criar backup atual e validar a migração antes de qualquer substituição.
