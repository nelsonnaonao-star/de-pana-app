-- ============================================================
-- PARCHE 15 - Teléfono propio por autoservicio
-- Fecha: 2026-11-15
--
-- Qué hace:
--   Permite que un usuario autenticado guarde su propio número cuando
--   su perfil quedó sin phone_number (altas antiguas o upsert fallido).
--   Valida formato y evita que dos perfiles usen el mismo número.
--
-- Seguridad:
--   SECURITY DEFINER con search_path fijo.
--   Solo modifica la fila de auth.uid().
--   No expone el teléfono de otros perfiles.
--
-- Aplicar en Supabase SQL Editor (idempotente).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.set_my_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_uid uuid := auth.uid();
  v_conflict uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF length(v_digits) < 7 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;

  SELECT p.id INTO v_conflict
  FROM public.profiles p
  WHERE p.phone_digits = v_digits
    AND p.id <> v_uid
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'phone_already_registered';
  END IF;

  UPDATE public.profiles
  SET phone_number = '+' || v_digits,
      updated_at = now()
  WHERE id = v_uid;

  RETURN '+' || v_digits;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_phone(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_phone(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_phone(text) TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- SELECT p.proname,
--        array_to_string(array(
--          SELECT r.rolname
--          FROM aclexplode(p.proacl) a
--          JOIN pg_roles r ON r.oid = a.grantee
--          WHERE a.privilege_type = 'EXECUTE'
--        ), ',') AS grantees
-- FROM pg_proc p
-- JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public'
--   AND p.proname = 'set_my_phone';
-- ============================================================
