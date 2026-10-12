-- Verificação ADMINISTRATIVA de leitura, após executar a migração.
-- Não testa JWTs reais, concorrência, frontend, configuração do Auth ou partilhas.
BEGIN READ ONLY;

SELECT c.owner_uid, c.max_devices,
  EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = c.owner_uid) AS owner_exists,
  c.max_devices = 3 AS correct_limit
FROM personal_app_private.settings AS c
WHERE c.singleton;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner
FROM pg_catalog.pg_class AS c
WHERE c.oid = 'public.notes'::regclass;

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public' AND tablename = 'notes'
  AND policyname IN ('notes_personal_restriction', 'notes_personal_owner_access')
ORDER BY policyname;

SELECT n.nspname AS schema_name, p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer, p.provolatile AS volatility, p.proconfig,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'personal_app_private'
   OR (n.nspname = 'public' AND p.proname IN (
     'personal_app_access', 'personal_app_list_devices', 'personal_app_revoke_device', 'claim_notes_reminders'
   ))
ORDER BY n.nspname, p.proname;

-- Cada uma destas permissões sobre tabelas privadas deve ser false.
SELECT c.relname AS private_table,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_any_table_privilege,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated_any_table_privilege,
  pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') AS anon_any_column_privilege,
  pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES') AS authenticated_any_column_privilege
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'personal_app_private' AND c.relkind = 'r'
ORDER BY c.relname;

-- anon_any_* e authenticated_can_truncate têm de ser false.
SELECT
  pg_catalog.has_table_privilege('anon', 'public.notes', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon_any_table_privilege,
  pg_catalog.has_any_column_privilege('anon', 'public.notes', 'SELECT,INSERT,UPDATE,REFERENCES') AS anon_any_column_privilege,
  pg_catalog.has_table_privilege('authenticated', 'public.notes', 'TRUNCATE') AS authenticated_can_truncate,
  pg_catalog.has_table_privilege('authenticated', 'public.notes', 'SELECT') AS authenticated_can_select_subject_to_rls;

SELECT count(*) AS active_registered_sessions, count(*) <= 3 AS within_limit
FROM personal_app_private.devices AS d
JOIN personal_app_private.settings AS c ON c.singleton AND c.owner_uid = d.user_id
JOIN auth.sessions AS s ON s.id = d.session_id AND s.user_id = d.user_id
WHERE d.revoked_at IS NULL AND (s.not_after IS NULL OR s.not_after > now());

-- Apenas a quantidade de sessões Auth reais do proprietário; não listar IDs/tokens.
SELECT count(*) AS valid_owner_auth_sessions
FROM auth.sessions AS s
JOIN personal_app_private.settings AS c ON c.singleton AND c.owner_uid = s.user_id
WHERE s.not_after IS NULL OR s.not_after > now();

SELECT installed_at, installed_by,
  original_state ->> 'table' AS snapshotted_table,
  original_state ? 'table_acl' AND original_state ? 'column_acl'
    AND original_state ? 'policies' AS original_permissions_recorded,
  original_state -> 'claim_notes_reminders' ->> 'signature' AS snapshotted_claim_function,
  (original_state -> 'claim_notes_reminders' ? 'definition')
    AND (original_state -> 'claim_notes_reminders' ? 'acl') AS original_claim_recorded
FROM personal_app_private.installation_snapshot;

ROLLBACK;
