-- ============================================================
-- PARCHE 16 - Registro con teléfono obligatorio
-- Fecha: 2026-11-16
--
-- Qué hace:
--   1) public.handle_new_user() toma username, phone y real_email
--      del user_metadata que envía el cliente al registrarse.
--   2) Si el teléfono falta o no tiene entre 7 y 15 dígitos, aborta
--      el alta del usuario con la excepción 'phone_required'.
--
-- Requisito:
--   Desplegar WEPA 1.16+ ANTES de aplicar este parche. El cliente
--   anterior no envía el teléfono en metadata y sus registros
--   fallarán con 'phone_required'. Es intencional: evita que se
--   creen perfiles nuevos sin teléfono.
--
--   Los usuarios creados por admin (Dashboard, scripts) también
--   deben enviar user_metadata.phone.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phone_digits text;
BEGIN
  v_phone_digits := regexp_replace(
    coalesce(NEW.raw_user_meta_data->>'phone', ''),
    '\D',
    '',
    'g'
  );

  IF length(v_phone_digits) < 7 OR length(v_phone_digits) > 15 THEN
    RAISE EXCEPTION 'phone_required';
  END IF;

  INSERT INTO public.profiles (
    id, name, username, email, real_email, phone_number, pin, avatar, role, status
  )
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'name', ''),
      split_part(NEW.email, '@', 1)
    ),
    NULLIF(NEW.raw_user_meta_data->>'username', ''),
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'real_email', ''),
    '+' || v_phone_digits,
    public.generate_pin(),
    '🧑',
    'Usuario',
    'online'
  );

  RETURN NEW;
END;
$$;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- 1) La función debe aceptar metadata con phone y username:
--   SELECT pg_get_functiondef(p.oid)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
--
-- 2) Prueba controlada (crear y borrar un usuario de prueba):
--   - Crear por Auth Admin API con:
--       user_metadata: { name, username, phone, real_email }
--   - Verificar que profiles tenga phone_number y phone_digits.
--   - Borrar el usuario (cascade elimina el perfil).
--
-- 3) Un alta sin phone debe fallar:
--       user_metadata: { name }
--   Debe devolver error 'phone_required' y no dejar perfil.
--
-- ============================================================
-- ROLLBACK
-- ============================================================
-- Restaura la versión anterior (sin guardia y sin metadata):
-- CREATE OR REPLACE FUNCTION public.handle_new_user()
-- RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path = public, pg_temp AS $$
-- BEGIN
--   INSERT INTO public.profiles (id, name, email, pin, avatar, role, status)
--   VALUES (
--     NEW.id,
--     COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
--     NEW.email,
--     public.generate_pin(),
--     '🧑',
--     'Usuario',
--     'online'
--   );
--   RETURN NEW;
-- END;
-- $$;
