# Google login — configuration checklist
The login button is implemented for web and native wrappers, with PKCE and callback `notaspro://auth/callback`.
Production acceptance is **not complete** until the Google provider and Supabase redirect allowlist are configured and a real account test passes.

1. Supabase Authentication > Providers > Google: configure a Google OAuth client ID and secret in the Supabase console; do not store secrets in the repository.
2. Register Google's callback URL supplied by Supabase with Google Cloud.
3. Supabase Authentication > URL Configuration: add `notaspro://auth/callback` to allowed redirects and the legitimate website URL.
4. To preserve the same note owner identity, verify the signed-in user's UUID is the existing notes owner. When it is not, do **not** change note ownership; link the Google identity to the existing account through an authorized identity-linking flow.
5. Android app has a manifest deep-link for `notaspro://auth/callback`; Windows app registers `notaspro` protocol on installation.
6. Verify sign-in, sign-out, session recovery, rejected callbacks and revocation on Windows, Android and web before deployment.
7. The existing `personal_app_access` gate still limits sessions to three devices and always requires an online access check.
