-- Teste administrativo da camada PostgreSQL/RPC, DEPOIS da migração pessoal.
-- Executar o ficheiro inteiro no SQL Editor como postgres, sem selecionar partes.
-- Requer quatro sessões Auth reais e válidas do proprietário e outra conta Auth.
-- Não cria tokens, não testa autenticação HTTP e não escreve em auth.*, notes,
-- tabelas de partilhas/lembretes ou configurações. Não chama o cron.
--
-- As quatro sessões são escolhidas internamente, sem mostrar IDs ou tokens.
-- O mesmo advisory lock da admissão é adquirido antes de limpar devices.
-- Só os registos privados de dispositivos são alterados, dentro desta transação;
-- ROLLBACK restaura os registos originais e remove todas as tabelas temporárias.
-- As chamadas às RPCs e as contagens RLS executam como authenticated, sem bypass.
-- Os GUCs de claims são simulações locais; não são credenciais de utilizadores.
--
-- Resultado esperado: todas as linhas com resultado OK, incluindo os snapshots.
-- Qualquer falha gera uma exceção com labels, sem valores de claims ou IDs.
-- Se o SQL Editor interromper na exceção, executar ROLLBACK; imediatamente.
-- A reposição dos GUCs trata uma definição ausente e a string vazia como neutras:
-- o PostgreSQL pode conservar o placeholder de um GUC customizado após o reset.

BEGIN;

CREATE TEMP TABLE personal_session_test_context (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  original_current_user name NOT NULL,
  original_session_user name NOT NULL,
  original_role text NOT NULL,
  original_gucs jsonb NOT NULL,
  ready boolean NOT NULL DEFAULT false,
  owner_uid uuid,
  other_uid uuid,
  session_ids uuid[],
  owner_notes bigint
) ON COMMIT DROP;

CREATE TEMP TABLE personal_session_test_results (
  seq integer PRIMARY KEY,
  label text NOT NULL,
  passed boolean NOT NULL,
  observed bigint,
  expected bigint
) ON COMMIT DROP;

INSERT INTO pg_temp.personal_session_test_context (
  original_current_user, original_session_user, original_role, original_gucs
)
SELECT CURRENT_USER, SESSION_USER, pg_catalog.current_setting('role'),
  pg_catalog.jsonb_object_agg(g.name, pg_catalog.current_setting(g.name, true))
FROM (VALUES
  ('request.jwt.claims'), ('request.jwt.claim'), ('request.jwt.claim.sub'),
  ('request.jwt.claim.role'), ('request.jwt.claim.session_id')
) AS g(name);

REVOKE ALL ON TABLE pg_temp.personal_session_test_context,
  pg_temp.personal_session_test_results FROM PUBLIC;
GRANT SELECT ON TABLE pg_temp.personal_session_test_context TO authenticated;
GRANT INSERT ON TABLE pg_temp.personal_session_test_results TO authenticated;

DO $preflight$
DECLARE
  v_owner uuid;
  v_other uuid;
  v_sessions uuid[];
  v_notes bigint;
BEGIN
  IF CURRENT_USER <> 'postgres'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'preflight_role_ou_isolamento';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'authenticated' AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'preflight_authenticated_ignora_rls';
  END IF;
  SELECT c.owner_uid INTO STRICT v_owner
  FROM personal_app_private.settings AS c
  WHERE c.singleton AND c.max_devices = 3
    AND c.owner_uid = '38409eff-d6a5-49ef-b2a2-1d2a8312cc1b'::uuid;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(1600283497, 3) THEN
    RAISE EXCEPTION 'preflight_lock_ocupado_repetir_apos_pedido_atual';
  END IF;

  SELECT pg_catalog.array_agg(s.id ORDER BY s.id) INTO v_sessions
  FROM (
    SELECT s.id FROM auth.sessions AS s
    WHERE s.user_id = v_owner
      AND (s.not_after IS NULL OR s.not_after > now())
    ORDER BY s.id LIMIT 4
  ) AS s;
  IF COALESCE(pg_catalog.cardinality(v_sessions), 0) <> 4 THEN
    RAISE EXCEPTION 'preflight_requer_quatro_sessoes_reais_validas';
  END IF;
  SELECT u.id INTO v_other FROM auth.users AS u
  WHERE u.id <> v_owner
  ORDER BY (SELECT count(*) FROM public.notes AS n WHERE n.user_id = u.id) DESC,
    u.id LIMIT 1;
  IF v_other IS NULL THEN
    RAISE EXCEPTION 'preflight_requer_outra_identidade_existente';
  END IF;
  SELECT count(*) INTO v_notes FROM public.notes WHERE user_id = v_owner;
  IF v_notes = 0 THEN
    RAISE EXCEPTION 'preflight_requer_notas_do_dono_para_controle_positivo_rls';
  END IF;

  -- O lock já está detido. Nenhum dado do Auth ou das notas é alterado.
  DELETE FROM personal_app_private.devices;
  UPDATE pg_temp.personal_session_test_context
  SET ready = true, owner_uid = v_owner, other_uid = v_other,
    session_ids = v_sessions, owner_notes = v_notes
  WHERE singleton;
  INSERT INTO pg_temp.personal_session_test_results
  VALUES (0, 'preflight_quatro_sessoes_reais_e_lock', true, 4, 4);
END;
$preflight$;

SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_context record;
  v_step record;
  v_uid uuid;
  v_sid uuid;
  v_claims text;
  v_response jsonb;
  v_reason text;
  v_pass boolean;
  v_observed bigint;
  v_expected bigint;
  v_foreign bigint;
  v_current bigint;
  v_first bigint;
  v_stage text := 'inicio';
BEGIN
  SELECT * INTO STRICT v_context FROM pg_temp.personal_session_test_context
  WHERE singleton AND ready;

  FOR v_step IN
    SELECT * FROM (VALUES
      (10, 'sessao_1_admitida',                  true,  1, 'admit',         0, 1),
      (20, 'sessao_2_admitida',                  true,  2, 'admit',         0, 2),
      (30, 'sessao_3_admitida',                  true,  3, 'admit',         0, 3),
      (40, 'sessao_3_le_apenas_notas_do_dono',   true,  3, 'read_owner',    0, 0),
      (50, 'sessao_4_bloqueada_pelo_limite',     true,  4, 'limit',         0, 3),
      (60, 'sessao_4_nao_le_notas',              true,  4, 'read_none',     0, 0),
      (70, 'sessao_4_pode_listar_tres_slots',    true,  4, 'list',          0, 3),
      (80, 'outra_identidade_negada',           false, 1, 'not_owner',     0, 0),
      (90, 'outra_identidade_nao_le_notas',      false, 1, 'read_none',     0, 0),
      (100, 'sessao_4_revoga_sessao_1',          true,  4, 'revoke',        1, 1),
      (110, 'sessao_1_nao_pode_readmitir_se',    true,  1, 'revoked',       0, 0),
      (120, 'sessao_1_revogada_nao_le_notas',    true,  1, 'read_none',     0, 0),
      (130, 'sessao_1_revogada_nao_pode_listar', true,  1, 'list_denied',   0, 0),
      (140, 'sessao_4_ocupa_slot_libertado',     true,  4, 'admit',         0, 3),
      (150, 'sessao_4_admitida_le_suas_notas',   true,  4, 'read_owner',    0, 0),
      (160, 'lista_tem_tres_e_sessao_atual',     true,  4, 'list_current',  0, 3),
      (170, 'revogacao_persiste_apos_substituir',true,  1, 'revoked',       0, 0),
      (180, 'outra_identidade_nao_pode_listar',  false, 1, 'list_denied',   0, 0),
      (190, 'outra_identidade_nao_pode_revogar', false, 1, 'revoke_denied', 2, 0),
      (200, 'sessao_revogada_nao_pode_revogar',  true,  1, 'revoke_denied', 2, 0)
    ) AS steps(seq, label, is_owner, slot, operation, argument_slot, expected)
    ORDER BY seq
  LOOP
    v_stage := v_step.label;
    v_uid := CASE WHEN v_step.is_owner THEN v_context.owner_uid ELSE v_context.other_uid END;
    v_sid := v_context.session_ids[v_step.slot];
    -- Para a outra conta troca-se apenas o subject: a negação not_owner deve
    -- preceder a autorização de sessão. Isto não representa um JWT HTTP válido.
    v_claims := pg_catalog.jsonb_build_object(
      'sub', v_uid, 'session_id', v_sid, 'role', 'authenticated', 'aud', 'authenticated'
    )::text;
    PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);
    PERFORM pg_catalog.set_config('request.jwt.claim', v_claims, true);
    PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_uid::text, true);
    PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM pg_catalog.set_config('request.jwt.claim.session_id', v_sid::text, true);
    IF CURRENT_USER <> 'authenticated'
       OR pg_catalog.current_setting('role') <> 'authenticated'
       OR auth.uid() IS DISTINCT FROM v_uid
       OR (auth.jwt() ->> 'session_id') IS DISTINCT FROM v_sid::text
       OR (auth.jwt() ->> 'sub') IS DISTINCT FROM v_uid::text
       OR (auth.jwt() ->> 'role') IS DISTINCT FROM 'authenticated' THEN
      RAISE EXCEPTION 'snapshot_de_role_ou_claims_incorreto';
    END IF;

    v_pass := false;
    v_observed := NULL;
    v_expected := v_step.expected;
    CASE
      WHEN v_step.operation IN ('admit', 'limit', 'not_owner', 'revoked') THEN
        v_response := public.personal_app_access('Teste transacional; revertido');
        v_reason := CASE v_step.operation
          WHEN 'admit' THEN 'authorized' WHEN 'limit' THEN 'device_limit'
          WHEN 'not_owner' THEN 'not_owner' ELSE 'session_revoked' END;
        v_observed := (v_response ->> 'active_devices')::bigint;
        v_pass := (v_response ->> 'allowed')::boolean = (v_step.operation = 'admit')
          AND v_response ->> 'reason' = v_reason
          AND (v_response ->> 'max_devices')::integer = 3
          AND v_observed = v_expected;
      WHEN v_step.operation IN ('read_owner', 'read_none') THEN
        SELECT count(*), count(*) FILTER (WHERE user_id IS DISTINCT FROM v_context.owner_uid)
        INTO v_observed, v_foreign FROM public.notes;
        v_expected := CASE WHEN v_step.operation = 'read_owner' THEN v_context.owner_notes ELSE 0 END;
        v_pass := v_observed = v_expected AND v_foreign = 0;
      WHEN v_step.operation IN ('list', 'list_current') THEN
        v_response := public.personal_app_list_devices();
        v_observed := pg_catalog.jsonb_array_length(v_response);
        SELECT count(*) FILTER (WHERE (e.item ->> 'is_current')::boolean),
          count(*) FILTER (WHERE e.item ->> 'session_id' = v_context.session_ids[1]::text)
        INTO v_current, v_first
        FROM pg_catalog.jsonb_array_elements(v_response) AS e(item);
        v_pass := v_observed = v_expected
          AND v_current = CASE WHEN v_step.operation = 'list_current' THEN 1 ELSE 0 END
          AND (v_step.operation <> 'list_current' OR v_first = 0);
      WHEN v_step.operation = 'revoke' THEN
        v_response := public.personal_app_revoke_device(v_context.session_ids[v_step.argument_slot]);
        v_observed := CASE WHEN (v_response ->> 'revoked')::boolean THEN 1 ELSE 0 END;
        v_pass := v_observed = v_expected;
      WHEN v_step.operation IN ('list_denied', 'revoke_denied') THEN
        BEGIN
          IF v_step.operation = 'list_denied' THEN
            PERFORM public.personal_app_list_devices();
          ELSE
            PERFORM public.personal_app_revoke_device(v_context.session_ids[v_step.argument_slot]);
          END IF;
          -- Se uma gestão indevida for permitida, reverter a chamada nesta
          -- subtransação antes de assinalar falha e prosseguir com outros casos.
          RAISE EXCEPTION 'gestao_permitida_inesperadamente' USING ERRCODE = 'ZP001';
        EXCEPTION
          WHEN insufficient_privilege THEN v_observed := 0; v_pass := true;
          WHEN SQLSTATE 'ZP001' THEN v_observed := 1; v_pass := false;
        END;
      ELSE RAISE EXCEPTION 'operacao_de_teste_desconhecida';
    END CASE;
    INSERT INTO pg_temp.personal_session_test_results
    VALUES (v_step.seq, v_stage, COALESCE(v_pass, false), v_observed, v_expected);
  END LOOP;
  INSERT INTO pg_temp.personal_session_test_results
  VALUES (210, 'role_e_claims_verificados_em_todos_os_casos', true, 20, 20);
EXCEPTION WHEN OTHERS THEN
  -- Não devolver SQLERRM/DETAIL: uma mensagem interna pode conter identificadores.
  INSERT INTO pg_temp.personal_session_test_results
  VALUES (999, 'erro_' || v_stage || '_sqlstate_' || SQLSTATE, false, NULL, NULL);
END;
$test$;

SET LOCAL ROLE postgres;

DO $restore_and_assert$
DECLARE
  v_context record;
  v_guc record;
  v_gucs_ok boolean;
  v_roles_ok boolean;
  v_failures text;
BEGIN
  SELECT * INTO STRICT v_context FROM pg_temp.personal_session_test_context WHERE singleton;
  FOR v_guc IN SELECT * FROM pg_catalog.jsonb_each_text(v_context.original_gucs)
  LOOP
    PERFORM pg_catalog.set_config(v_guc.key, COALESCE(v_guc.value, ''), true);
  END LOOP;
  PERFORM pg_catalog.set_config('role', v_context.original_role, true);
  SELECT pg_catalog.bool_and(
    NULLIF(pg_catalog.current_setting(g.key, true), '') IS NOT DISTINCT FROM NULLIF(g.value, '')
  ) INTO v_gucs_ok
  FROM pg_catalog.jsonb_each_text(v_context.original_gucs) AS g;
  v_roles_ok := CURRENT_USER = v_context.original_current_user
    AND SESSION_USER = v_context.original_session_user
    AND pg_catalog.current_setting('role') = v_context.original_role;
  INSERT INTO pg_temp.personal_session_test_results VALUES
    (220, 'gucs_de_claims_repostos', COALESCE(v_gucs_ok, false), CASE WHEN v_gucs_ok THEN 5 ELSE 0 END, 5),
    (230, 'role_e_session_user_repostos', v_roles_ok, CASE WHEN v_roles_ok THEN 1 ELSE 0 END, 1);

  SELECT pg_catalog.string_agg(label, ', ' ORDER BY seq) INTO v_failures
  FROM pg_temp.personal_session_test_results WHERE NOT passed;
  IF v_failures IS NOT NULL THEN
    RAISE EXCEPTION 'Teste falhou: %. Executar ROLLBACK se o editor interromper aqui.', v_failures;
  END IF;
END;
$restore_and_assert$;

SELECT label AS teste, CASE WHEN passed THEN 'OK' ELSE 'FALHOU' END AS resultado,
  observed AS contagem, expected AS esperado
FROM pg_temp.personal_session_test_results ORDER BY seq;

ROLLBACK;
