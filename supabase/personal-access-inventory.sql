-- Inventário de leitura antes da instalação. Executar como postgres no painel
-- Supabase; rever os resultados. Não mostra conteúdo de notas, passwords,
-- refresh tokens, access tokens nem código potencialmente portador de segredos.
BEGIN READ ONLY;

-- Confirmar manualmente o UUID correto pelo e-mail da conta de Jonathan.
SELECT id, email, created_at, last_sign_in_at
FROM auth.users
ORDER BY created_at, id;

-- Quantidades, sem conteúdo. Outros user_id NÃO são eliminados pela migração.
SELECT user_id, count(*) AS note_count
FROM public.notes
GROUP BY user_id
ORDER BY note_count DESC, user_id;

-- Verificar as colunas de que o controlo de sessão depende.
SELECT table_schema, table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE (table_schema = 'auth' AND table_name = 'sessions')
   OR (table_schema = 'public' AND table_name = 'notes')
ORDER BY table_schema, table_name, ordinal_position;

SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced,
  c.relispartition
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.oid = 'public.notes'::regclass;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE (schemaname = 'public' AND tablename = 'notes')
   OR schemaname = 'personal_app_private'
ORDER BY schemaname, tablename, policyname;

SELECT grantor, grantee, table_schema, table_name, privilege_type, is_grantable
FROM information_schema.table_privileges
WHERE (table_schema = 'public' AND table_name = 'notes')
   OR table_schema = 'personal_app_private'
ORDER BY table_schema, table_name, grantee, privilege_type;

SELECT grantor, grantee, table_schema, table_name, column_name, privilege_type, is_grantable
FROM information_schema.column_privileges
WHERE (table_schema = 'public' AND table_name = 'notes')
   OR table_schema = 'personal_app_private'
ORDER BY table_schema, table_name, column_name, grantee, privilege_type;

SELECT rolname, rolsuper, rolbypassrls, rolinherit,
  pg_catalog.pg_has_role(oid, 'postgres'::regrole, 'MEMBER') AS member_of_postgres
FROM pg_catalog.pg_roles
WHERE rolname IN ('anon', 'authenticated', 'service_role', 'postgres');

-- Views e materialized views que dependem de notes, incluindo encadeamento.
-- Uma view com proprietário que ignora RLS pode contornar políticas da tabela.
WITH RECURSIVE dependent_views(oid) AS (
  SELECT r.ev_class
  FROM pg_catalog.pg_rewrite AS r
  JOIN pg_catalog.pg_depend AS d
    ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
  WHERE d.refobjid = 'public.notes'::regclass
    AND r.ev_class <> 'public.notes'::regclass
  UNION
  SELECT r.ev_class
  FROM pg_catalog.pg_rewrite AS r
  JOIN pg_catalog.pg_depend AS d
    ON d.classid = 'pg_rewrite'::regclass AND d.objid = r.oid
  JOIN dependent_views AS parent ON parent.oid = d.refobjid
  WHERE r.ev_class <> parent.oid
)
SELECT n.nspname AS schema_name, c.relname AS view_name, c.relkind,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
  c.reloptions,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select
FROM dependent_views AS d
JOIN pg_catalog.pg_class AS c ON c.oid = d.oid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
ORDER BY n.nspname, c.relname;

-- RPCs expostas e funções com provável acesso a notes/partilhas. O inventário
-- não imprime corpos; a auditoria seguinte deve ler o código das candidatas.
SELECT n.nspname AS schema_name, p.proname AS routine_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner,
  p.proconfig AS function_settings,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE p.prokind IN ('f', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth')
  AND (n.nspname IN ('public', 'personal_app_private')
    OR p.prosrc ~* '(notes|share|partilh)')
ORDER BY n.nspname, p.proname, arguments;

-- Tabelas/views de partilhas ou lembretes precisam de auditoria própria.
SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind,
  c.relrowsecurity AS rls_enabled,
  pg_catalog.pg_get_userbyid(c.relowner) AS owner,
  pg_catalog.has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_select,
  pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_select
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth')
  AND c.relname ~* '(notes|share|partilh|remind)'
ORDER BY n.nspname, c.relname;

ROLLBACK;
