-- A1 — Recuperación de contraseña: incremento ATÓMICO de intentos.
--
-- ⚠ PENDIENTE DE APLICACIÓN REMOTA. NO EJECUTAR automáticamente.
-- Aplicar en: Supabase Dashboard → SQL Editor → New Query → Run
-- (o pipeline de migraciones controlado). Requiere revisión previa.
--
-- Motivo:
--   supabase-js/PostgREST NO permiten `attempts = attempts + 1` mediante
--   `.update()` (no admite expresiones aritméticas). Un read-modify-write en el
--   servidor pierde incrementos bajo concurrencia: dos peticiones leen el mismo
--   valor y escriben el mismo resultado, permitiendo eludir el límite de 5
--   intentos. Esta función hace el incremento y el bloqueo en UNA sola
--   sentencia atómica.
--
-- Contrato (coincide con server/src/routes/auth.js):
--   * p_id           → registro de `password_reset_codes` a incrementar.
--   * p_max_attempts → máximo de intentos (el backend envía 5).
--   * Devuelve la fila actualizada (attempts, used). Si el registro ya estaba
--     usado/bloqueado, devuelve 0 filas (no incrementa).
--
-- Seguridad:
--   * SECURITY DEFINER con search_path fijo (evita secuestro de search_path).
--   * Valida parámetros (uuid garantizado por tipo; rango de p_max_attempts).
--   * Permisos mínimos: solo `service_role` (backend) ejecuta la función; se
--     revoca EXECUTE de PUBLIC/anon/authenticated.

CREATE OR REPLACE FUNCTION public.increment_password_reset_attempt(
  p_id uuid,
  p_max_attempts integer
)
RETURNS TABLE (attempts integer, used boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'p_id es obligatorio' USING ERRCODE = '22004';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'p_max_attempts fuera de rango (1..100)' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.password_reset_codes AS c
     SET attempts = c.attempts + 1,
         used     = (c.attempts + 1) >= p_max_attempts
   WHERE c.id = p_id
     AND c.used = false
  RETURNING c.attempts, c.used;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_password_reset_attempt(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_password_reset_attempt(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.increment_password_reset_attempt(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_password_reset_attempt(uuid, integer) TO service_role;
