-- ============================================================
-- PARCHE 12 - Endurecer funciones (search_path + EXECUTE de anon)
-- Fecha: 2026-11-09
-- Proyecto verificado: akgsylutbpgolurkcavh
--
-- ESTADO: se puede ejecutar YA. Reversible (ver ROLLBACK).
--
-- Hallazgos (Supabase Security Advisor):
--   - 8 funciones con `search_path` mutable.
--   - 6 funciones SECURITY DEFINER ejecutables por `anon`.
--
-- Qué hace:
--   1) Fija `search_path = public, pg_temp` en TODAS las funciones públicas
--      que no lo tengan (previene hijacking de search_path).
--   2) Revoca EXECUTE de PUBLIC/anon sobre funciones de trigger/utilidad.
--      Se mantienen intencionalmente para anon:
--        - public.get_public_profile(uuid)   (perfil público por id, QR)
--        - public.validate_promo_code(text)  (validación de código en registro)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) search_path seguro en todas las funciones de public
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, pg_temp',
      r.sig
    );
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2) Revocar EXECUTE de anon/PUBLIC en funciones de trigger/utilidad
-- ------------------------------------------------------------
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.admins_touch_updated_at()',
    'public.calls_guard_sensitive_fields()',
    'public.chats_guard_sensitive_fields()',
    'public.messages_guard_sensitive_fields()',
    'public.clean_stale_presence()',
    'public.cleanup_old_chat_unread_pings()',
    'public.update_updated_at()',
    'public.sync_phone_digits()',
    'public.handle_new_user()',
    'public.generate_pin()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
    END IF;
  END LOOP;
END $$;

-- Funciones de trigger que pueden dispararse en sesiones `authenticated`
-- (p. ej. UPDATE de profiles.status / chats). Se conserva EXECUTE para que
-- ningún trigger legítimo se rompa; solo se corta el acceso de anon.
DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'public.admins_touch_updated_at()',
    'public.calls_guard_sensitive_fields()',
    'public.chats_guard_sensitive_fields()',
    'public.messages_guard_sensitive_fields()',
    'public.update_updated_at()',
    'public.sync_phone_digits()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- 1) Debe devolver 0 filas:
--   SELECT p.proname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.prokind = 'f'
--     AND NOT EXISTS (
--       SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
--       WHERE c LIKE 'search_path=%'
--     );
--
-- 2) `anon` no debe ejecutar funciones de trigger/utilidad:
--   SELECT p.proname
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('handle_new_user','generate_pin','update_updated_at',
--                       'sync_phone_digits','clean_stale_presence',
--                       'cleanup_old_chat_unread_pings','admins_touch_updated_at')
--     AND has_function_privilege('anon', p.oid, 'EXECUTE');
--   -- (no debe devolver filas)
--
-- 3) Advisor de Supabase (debe bajar de 8/6 WARN):
--   supabase db advisors --linked --type security

-- ============================================================
-- ROLLBACK
-- ============================================================
-- -- Restaurar search_path mutable (NO recomendado):
-- ALTER FUNCTION public.update_updated_at() RESET search_path;
-- -- Restaurar EXECUTE de anon (NO recomendado):
-- GRANT EXECUTE ON FUNCTION public.generate_pin() TO anon;
-- ============================================================

-- ============================================================
-- NOTAS QUE NO SON SQL
-- ============================================================
-- A) Protección de contraseñas filtradas (advisor
--    `auth_leaked_password_protection`): activar en
--    Dashboard > Authentication > Settings > "Leaked password protection"
--    (HaveIBeenPwned). No se puede activar por SQL.
--
-- B) CORRECCIÓN al plan original sobre /api/auth/lookup-profile y
--    /api/auth/check-duplicate:
--      NO se les debe exigir auth: se usan ANTES de iniciar sesión
--      (login y registro). Requerir token rompería ambos flujos.
--    Mitigación correcta (código, server/src/routes/auth.js):
--      - Mantener rate limit, pero con keyGenerator por IP + identificador
--        (evita que un proxy rote IPs y siga enumerando).
--      - lookup-profile: respuesta genérica y mismo tiempo de respuesta.
--      - check-duplicate: aceptar el riesgo (oráculo necesario para UX) y
--        añadir CAPTCHA/app-attestation en registro.
-- ============================================================
