-- Bloco de Notas Pro: uma conta, no máximo três sessões autorizadas.
-- EXECUTAR APENAS DEPOIS de rever personal-access-inventory.sql e o documento
-- personal-access.md. Este ficheiro, por si só, não desativa registos no Auth,
-- o alojamento público do HTML nem eventuais Edge Functions de partilha.
--
-- PARÂMETRO VERIFICADO: UUID da conta do proprietário, corroborada no
-- painel Authentication > Users e na conta da aplicação publicada. A migração
-- ainda não foi executada. Não escolher proprietário pela ordem dos utilizadores.
-- O valor fica numa tabela privada; user_metadata não é usado para autorizar.
--
-- A transação aborta integralmente se o parâmetro ou o esquema forem inválidos.
-- Repetir com o MESMO UUID é suportado e conserva os dispositivos e o snapshot.
-- Não elimina notas/utilizadores nem escreve em tabelas do esquema auth.

BEGIN;

DO $preflight$
DECLARE
  v_verified_owner_uid uuid := '38409eff-d6a5-49ef-b2a2-1d2a8312cc1b'::uuid; -- Conta confirmada no Auth e na aplicação.
  v_notes record;
  v_column record;
BEGIN
  IF v_verified_owner_uid IS NULL THEN
    RAISE EXCEPTION 'Configuração interrompida: definir explicitamente o UUID verificado da conta de Jonathan em v_verified_owner_uid.';
  END IF;
  IF CURRENT_USER <> 'postgres' THEN
    RAISE EXCEPTION 'Executar esta migração com a função postgres no SQL Editor, após rever o inventário.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = v_verified_owner_uid) THEN
    RAISE EXCEPTION 'O UUID indicado não corresponde a um utilizador existente em auth.users.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'As funções padrão do Supabase não estão disponíveis; rever o projeto antes de continuar.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Uma função da API tem privilégios que ignoram RLS. Corrigir antes de continuar.';
  END IF;
  IF pg_catalog.pg_has_role('anon', 'postgres', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', 'postgres', 'MEMBER') THEN
    RAISE EXCEPTION 'Uma função da API é membro de postgres. Rever privilégios antes de continuar.';
  END IF;

  SELECT c.relkind, c.relispartition, c.relowner INTO v_notes
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = pg_catalog.to_regclass('public.notes');
  IF NOT FOUND OR v_notes.relkind <> 'r' OR v_notes.relispartition THEN
    RAISE EXCEPTION 'Esperada uma tabela comum public.notes. Tabelas particionadas ou outro esquema exigem revisão específica.';
  END IF;
  IF pg_catalog.pg_has_role('anon', v_notes.relowner, 'MEMBER')
     OR pg_catalog.pg_has_role('authenticated', v_notes.relowner, 'MEMBER') THEN
    RAISE EXCEPTION 'Uma função da API pode assumir a propriedade de notes. Corrigir os privilégios primeiro.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.notes'::regclass AND a.attname = 'user_id'
      AND a.atttypid = 'uuid'::regtype AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'public.notes.user_id tem de existir com o tipo uuid.';
  END IF;

  FOR v_column IN
    SELECT * FROM (VALUES
      ('id', 'uuid'::regtype),
      ('user_id', 'uuid'::regtype),
      ('not_after', 'timestamp with time zone'::regtype)
    ) AS expected(column_name, column_type)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('auth.sessions')
        AND a.attname = v_column.column_name
        AND a.atttypid = v_column.column_type
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'auth.sessions.% não tem o tipo esperado; confirmar a versão do esquema Auth antes de instalar.', v_column.column_name;
    END IF;
  END LOOP;
  PERFORM 'auth.uid()'::regprocedure, 'auth.jwt()'::regprocedure;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc AS p
    WHERE p.oid = pg_catalog.to_regprocedure('public.claim_notes_reminders()')
      AND p.proretset
      AND p.prorettype = pg_catalog.to_regtype('public.notes_reminders')
      AND p.proowner = 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'claim_notes_reminders() não tem a assinatura/proprietário revistos. Interromper antes de alterar a função de lembretes.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace AS n
    WHERE n.nspname = 'personal_app_private'
      AND n.nspowner <> 'postgres'::regrole
  ) THEN
    RAISE EXCEPTION 'O esquema personal_app_private já existe com outro proprietário. Não foi alterado.';
  END IF;
  IF pg_catalog.to_regclass('personal_app_private.installation_snapshot') IS NULL
     AND EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS p
       WHERE p.polrelid = 'public.notes'::regclass
         AND p.polname IN ('notes_personal_restriction', 'notes_personal_owner_access')
     ) THEN
    RAISE EXCEPTION 'Já existe uma política com um nome reservado para esta migração, sem snapshot. Rever a instalação anterior.';
  END IF;

  -- Apenas transporte dentro desta transação. As RPCs nunca leem este setting.
  PERFORM pg_catalog.set_config('personal_app.install_owner_uid', v_verified_owner_uid::text, true);
END;
$preflight$;

CREATE SCHEMA IF NOT EXISTS personal_app_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA personal_app_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS personal_app_private.settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_uid uuid NOT NULL,
  max_devices integer NOT NULL DEFAULT 3 CHECK (max_devices = 3)
);

CREATE TABLE IF NOT EXISTS personal_app_private.devices (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
  -- Sem FK para auth.sessions: o tombstone deve sobreviver à limpeza do Auth.
);
CREATE INDEX IF NOT EXISTS personal_app_devices_active_owner_idx
  ON personal_app_private.devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS personal_app_private.installation_snapshot (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  installed_at timestamptz NOT NULL DEFAULT now(),
  installed_by name NOT NULL DEFAULT CURRENT_USER,
  original_state jsonb NOT NULL
);

ALTER TABLE personal_app_private.settings OWNER TO postgres;
ALTER TABLE personal_app_private.devices OWNER TO postgres;
ALTER TABLE personal_app_private.installation_snapshot OWNER TO postgres;
ALTER TABLE personal_app_private.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_app_private.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_app_private.installation_snapshot ENABLE ROW LEVEL SECURITY;

-- Defesa adicional contra concessões herdadas ou políticas antigas no esquema.
-- Os helpers executam como postgres; os papéis da API nunca escrevem diretamente.
DROP POLICY IF EXISTS personal_private_api_deny ON personal_app_private.settings;
CREATE POLICY personal_private_api_deny ON personal_app_private.settings
AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS personal_private_api_deny ON personal_app_private.devices;
CREATE POLICY personal_private_api_deny ON personal_app_private.devices
AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS personal_private_api_deny ON personal_app_private.installation_snapshot;
CREATE POLICY personal_private_api_deny ON personal_app_private.installation_snapshot
AS RESTRICTIVE FOR ALL TO PUBLIC USING (false) WITH CHECK (false);

INSERT INTO personal_app_private.settings (singleton, owner_uid, max_devices)
VALUES (true, pg_catalog.current_setting('personal_app.install_owner_uid')::uuid, 3)
ON CONFLICT (singleton) DO NOTHING;

DO $check_owner$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM personal_app_private.settings
    WHERE singleton
      AND owner_uid = pg_catalog.current_setting('personal_app.install_owner_uid')::uuid
      AND max_devices = 3
  ) THEN
    RAISE EXCEPTION 'Já existe uma configuração pessoal com outro proprietário ou limite. Nenhuma alteração foi aplicada.';
  END IF;
END;
$check_owner$;

-- Capturar o estado ANTES da primeira alteração de RLS/ACL. O snapshot original
-- nunca é sobrescrito quando se repete a migração. Só postgres tem acesso.
INSERT INTO personal_app_private.installation_snapshot (singleton, original_state)
SELECT true, pg_catalog.jsonb_build_object(
  'version', 1,
  'table', 'public.notes',
  'table_owner', pg_catalog.pg_get_userbyid(c.relowner),
  'rls_enabled', c.relrowsecurity,
  'rls_forced', c.relforcerowsecurity,
  'table_acl', COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'grantor', pg_catalog.pg_get_userbyid(a.grantor),
      'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege', a.privilege_type, 'grantable', a.is_grantable
    ))
    FROM pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS a
  ), '[]'::jsonb),
  'column_acl', COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'column', ca.attname,
      'grantor', pg_catalog.pg_get_userbyid(a.grantor),
      'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
      'privilege', a.privilege_type, 'grantable', a.is_grantable
    ))
    FROM pg_catalog.pg_attribute AS ca
    CROSS JOIN LATERAL pg_catalog.aclexplode(ca.attacl) AS a
    WHERE ca.attrelid = c.oid AND ca.attnum > 0 AND NOT ca.attisdropped
  ), '[]'::jsonb),
  'policies', COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p))
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'public' AND p.tablename = 'notes'
  ), '[]'::jsonb)
)
FROM pg_catalog.pg_class AS c WHERE c.oid = 'public.notes'::regclass
ON CONFLICT (singleton) DO NOTHING;

-- Acrescentar uma única vez a definição e ACL originais do claim, sem substituir
-- o snapshot de notes ou uma cópia da função previamente capturada.
UPDATE personal_app_private.installation_snapshot AS i
SET original_state = i.original_state || pg_catalog.jsonb_build_object(
  'claim_notes_reminders', pg_catalog.jsonb_build_object(
    'signature', 'public.claim_notes_reminders()',
    'definition', pg_catalog.pg_get_functiondef(p.oid),
    'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'acl', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'grantor', pg_catalog.pg_get_userbyid(a.grantor),
        'grantee', CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type, 'grantable', a.is_grantable
      ))
      FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
    ), '[]'::jsonb)
  )
)
FROM pg_catalog.pg_proc AS p
WHERE i.singleton
  AND NOT (i.original_state ? 'claim_notes_reminders')
  AND p.oid = 'public.claim_notes_reminders()'::regprocedure;

CREATE OR REPLACE FUNCTION personal_app_private.current_session_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_claim text := auth.jwt() ->> 'session_id';
BEGIN
  IF v_claim IS NULL OR v_claim !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN NULL;
  END IF;
  RETURN v_claim::uuid;
END;
$function$;

-- Autoriza a identidade/sessão para gerir dispositivos, mesmo sem um slot.
-- Sessões revogadas não podem gerir slots nem registar-se outra vez.
CREATE OR REPLACE FUNCTION personal_app_private.current_access_reason()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN 'unauthenticated'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM personal_app_private.settings AS c
    WHERE c.singleton AND c.owner_uid = v_uid AND c.max_devices = 3
  ) THEN RETURN 'not_owner'; END IF;

  v_sid := personal_app_private.current_session_id();
  IF v_sid IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions AS s
    WHERE s.id = v_sid AND s.user_id = v_uid
      AND (s.not_after IS NULL OR s.not_after > now())
  ) THEN RETURN 'invalid_session'; END IF;

  IF EXISTS (
    SELECT 1 FROM personal_app_private.devices AS d
    WHERE d.session_id = v_sid AND d.user_id <> v_uid
  ) THEN RETURN 'invalid_session'; END IF;
  IF EXISTS (
    SELECT 1 FROM personal_app_private.devices AS d
    WHERE d.session_id = v_sid AND d.revoked_at IS NOT NULL
  ) THEN RETURN 'session_revoked'; END IF;
  RETURN 'authorized';
END;
$function$;

CREATE OR REPLACE FUNCTION personal_app_private.active_device_count()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT count(*)::integer
  FROM personal_app_private.devices AS d
  JOIN personal_app_private.settings AS c ON c.singleton AND c.owner_uid = d.user_id
  JOIN auth.sessions AS s ON s.id = d.session_id AND s.user_id = d.user_id
  WHERE d.revoked_at IS NULL AND (s.not_after IS NULL OR s.not_after > now());
$function$;

-- Usada por RLS. Não recebe UUIDs do cliente. Não concede acesso apenas porque
-- o JWT é do proprietário: exige sessão Auth existente E registo autorizado.
CREATE OR REPLACE FUNCTION personal_app_private.notes_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM personal_app_private.settings AS c
    JOIN personal_app_private.devices AS d ON d.user_id = c.owner_uid
    JOIN auth.sessions AS s ON s.id = d.session_id AND s.user_id = c.owner_uid
    WHERE c.singleton AND c.max_devices = 3 AND c.owner_uid = auth.uid()
      AND d.session_id = personal_app_private.current_session_id()
      AND d.revoked_at IS NULL
      AND (s.not_after IS NULL OR s.not_after > now())
  );
$function$;

CREATE OR REPLACE FUNCTION public.personal_app_access(p_device_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reason text;
  v_sid uuid;
  v_uid uuid;
  v_count integer;
  v_name text;
BEGIN
  v_reason := personal_app_private.current_access_reason();
  IF v_reason <> 'authorized' THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', v_reason, 'active_devices', 0, 'max_devices', 3);
  END IF;

  -- A contagem após esperar pelo lock precisa de um snapshot atualizado.
  -- Recusar isolamento diferente em vez de admitir mais de três por snapshot antigo.
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'A admissão de dispositivos requer isolamento READ COMMITTED.' USING ERRCODE = '25000';
  END IF;

  -- Todas as admissões e revogações usam a mesma chave. O teste de capacidade
  -- e o INSERT ficam serializados; pedidos concorrentes não obtêm um 4.º slot.
  PERFORM pg_catalog.pg_advisory_xact_lock(1600283497, 3);
  v_reason := personal_app_private.current_access_reason();
  IF v_reason <> 'authorized' THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', v_reason, 'active_devices', 0, 'max_devices', 3);
  END IF;
  v_sid := personal_app_private.current_session_id();
  v_uid := auth.uid();
  v_name := NULLIF(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_device_name, ''), '[[:cntrl:]]', '', 'g')), 100), '');

  IF EXISTS (
    SELECT 1 FROM personal_app_private.devices AS d
    WHERE d.session_id = v_sid AND d.user_id = v_uid AND d.revoked_at IS NULL
  ) THEN
    UPDATE personal_app_private.devices
    SET last_seen_at = now(), device_name = COALESCE(v_name, device_name)
    WHERE session_id = v_sid AND user_id = v_uid AND revoked_at IS NULL;
  ELSE
    v_count := personal_app_private.active_device_count();
    IF v_count >= 3 THEN
      RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'device_limit', 'active_devices', v_count, 'max_devices', 3);
    END IF;
    INSERT INTO personal_app_private.devices (session_id, user_id, device_name)
    VALUES (v_sid, v_uid, COALESCE(v_name, 'Navegador'));
  END IF;

  v_count := personal_app_private.active_device_count();
  RETURN pg_catalog.jsonb_build_object('allowed', true, 'reason', 'authorized', 'active_devices', v_count, 'max_devices', 3);
END;
$function$;

CREATE OR REPLACE FUNCTION public.personal_app_list_devices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reason text := personal_app_private.current_access_reason();
  v_result jsonb;
BEGIN
  IF v_reason <> 'authorized' THEN
    RAISE EXCEPTION 'Acesso à gestão de dispositivos negado: %.', v_reason USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'session_id', d.session_id,
    'device_name', d.device_name,
    'created_at', d.created_at,
    'last_seen_at', d.last_seen_at,
    'is_current', d.session_id = personal_app_private.current_session_id()
  ) ORDER BY d.created_at, d.session_id), '[]'::jsonb)
  INTO v_result
  FROM personal_app_private.devices AS d
  JOIN auth.sessions AS s ON s.id = d.session_id AND s.user_id = d.user_id
  WHERE d.user_id = auth.uid() AND d.revoked_at IS NULL
    AND (s.not_after IS NULL OR s.not_after > now());
  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.personal_app_revoke_device(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reason text;
  v_affected integer;
BEGIN
  v_reason := personal_app_private.current_access_reason();
  IF v_reason <> 'authorized' THEN
    RAISE EXCEPTION 'Acesso à gestão de dispositivos negado: %.', v_reason USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(1600283497, 3);
  v_reason := personal_app_private.current_access_reason();
  IF v_reason <> 'authorized' THEN
    RAISE EXCEPTION 'Acesso à gestão de dispositivos negado: %.', v_reason USING ERRCODE = '42501';
  END IF;

  -- Não remover a linha: o mesmo JWT/session_id não pode reinscrever-se.
  UPDATE personal_app_private.devices
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE session_id = p_session_id AND user_id = auth.uid();
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('revoked', v_affected > 0);
END;
$function$;

ALTER FUNCTION personal_app_private.current_session_id() OWNER TO postgres;
ALTER FUNCTION personal_app_private.current_access_reason() OWNER TO postgres;
ALTER FUNCTION personal_app_private.active_device_count() OWNER TO postgres;
ALTER FUNCTION personal_app_private.notes_allowed() OWNER TO postgres;
ALTER FUNCTION public.personal_app_access(text) OWNER TO postgres;
ALTER FUNCTION public.personal_app_list_devices() OWNER TO postgres;
ALTER FUNCTION public.personal_app_revoke_device(uuid) OWNER TO postgres;

REVOKE ALL ON ALL TABLES IN SCHEMA personal_app_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA personal_app_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA personal_app_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA personal_app_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA personal_app_private REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
-- Um REVOKE por esquema só desfaz GRANTs por esquema; não remove o default
-- global de EXECUTE para PUBLIC. Novas funções precisam dos REVOKEs explícitos
-- na mesma transação, como acima. Não alterar o default global de postgres aqui.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA personal_app_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

-- A avaliação da política só precisa deste helper booleano. Nenhuma tabela ou
-- outro helper privado fica acessível. Não adicionar este esquema à Data API.
GRANT USAGE ON SCHEMA personal_app_private TO authenticated;
GRANT EXECUTE ON FUNCTION personal_app_private.notes_allowed() TO authenticated;

REVOKE ALL ON FUNCTION public.personal_app_access(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.personal_app_list_devices() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.personal_app_revoke_device(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.personal_app_access(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_app_list_devices() TO authenticated;
GRANT EXECUTE ON FUNCTION public.personal_app_revoke_device(uuid) TO authenticated;

-- REVOKE ao nível da tabela não apaga concessões feitas a colunas. Revogar
-- ambas as formas, incluindo as privadas, para impedir escrita em owner_uid.
DO $column_acl$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT n.nspname, c.relname,
      pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' ORDER BY a.attnum) AS columns
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    WHERE c.relkind = 'r'
      AND (c.oid = 'public.notes'::regclass OR n.nspname = 'personal_app_private')
    GROUP BY n.nspname, c.relname
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$I.%3$I FROM PUBLIC, anon, authenticated',
      v_table.columns, v_table.nspname, v_table.relname
    );
    IF v_table.nspname = 'personal_app_private' THEN
      EXECUTE pg_catalog.format(
        'REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$I.%3$I FROM service_role',
        v_table.columns, v_table.nspname, v_table.relname
      );
    END IF;
  END LOOP;
END;
$column_acl$;

REVOKE ALL ON TABLE public.notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.notes TO authenticated;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes FORCE ROW LEVEL SECURITY;

-- Uma política permissiva antiga pode continuar a existir, mas não ultrapassa
-- esta condição RESTRICTIVE, aplicada a todos os papéis sujeitos a RLS.
DROP POLICY IF EXISTS notes_personal_restriction ON public.notes;
CREATE POLICY notes_personal_restriction ON public.notes
AS RESTRICTIVE FOR ALL TO PUBLIC
USING (
  (SELECT personal_app_private.notes_allowed())
  AND user_id = (SELECT auth.uid())
)
WITH CHECK (
  (SELECT personal_app_private.notes_allowed())
  AND user_id = (SELECT auth.uid())
);

-- PostgreSQL precisa de pelo menos uma política permissiva aplicável.
DROP POLICY IF EXISTS notes_personal_owner_access ON public.notes;
CREATE POLICY notes_personal_owner_access ON public.notes
AS PERMISSIVE FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()))
WITH CHECK (user_id = (SELECT auth.uid()));

-- Preservar o claim do cron (lote de 40, ordem e SKIP LOCKED), limitando a
-- seleção E a escrita ao proprietário. Criar a função não processa lembretes.
CREATE OR REPLACE FUNCTION public.claim_notes_reminders()
RETURNS SETOF public.notes_reminders
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE public.notes_reminders AS r
  SET claimed_at = now()
  WHERE r.user_id = (
    SELECT c.owner_uid FROM personal_app_private.settings AS c
    WHERE c.singleton AND c.max_devices = 3
  )
  AND r.id IN (
    SELECT candidate.id FROM public.notes_reminders AS candidate
    WHERE candidate.user_id = (
      SELECT c.owner_uid FROM personal_app_private.settings AS c
      WHERE c.singleton AND c.max_devices = 3
    )
      AND candidate.status = 'scheduled'
      AND candidate.due_at <= now()
      AND (candidate.claimed_at IS NULL OR candidate.claimed_at < now() - interval '5 minutes')
    ORDER BY candidate.due_at
    LIMIT 40
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.*;
$function$;
ALTER FUNCTION public.claim_notes_reminders() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_notes_reminders() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_notes_reminders() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
