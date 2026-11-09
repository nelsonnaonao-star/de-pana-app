-- ============================================================
-- PARCHE 13 - Revocar RPC legacy `search_users`
-- Fecha: 2026-11-09
-- Proyecto: akgsylutbpgolurkcavh
--
-- Hallazgo (Security Advisor):
--   public.search_users(search_term text) es SECURITY DEFINER y ejecutable por
--   `authenticated`. Busca en profiles con:
--       email ILIKE '%term%'  OR  name ILIKE '%term%'  OR  pin ILIKE 'term%'
--   y devuelve id/name/avatar/role/status. Eso permite enumerar correos y
--   adivinar el `pin` de otros usuarios.
--
-- Uso: NO hay referencias a `search_users` en el cliente ni en el servidor
--   (verificado con grep en el repo). Es legado.
--
-- Acción: revocar EXECUTE de PUBLIC/anon/authenticated. Se conserva para
--   service_role (backend). Reversible.
-- ============================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.search_users(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_users(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_users(text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.search_users(text) TO service_role;

COMMIT;

-- ============================================================
-- VERIFICACIÓN (debe devolver false)
-- ============================================================
-- SELECT has_function_privilege('authenticated', 'public.search_users(text)', 'EXECUTE');
-- SELECT has_function_privilege('anon',          'public.search_users(text)', 'EXECUTE');

-- ============================================================
-- ROLLBACK
-- ============================================================
-- GRANT EXECUTE ON FUNCTION public.search_users(text) TO authenticated;
