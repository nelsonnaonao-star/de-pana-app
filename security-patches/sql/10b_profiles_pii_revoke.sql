-- ============================================================
-- PARCHE 10b - Revocar PII de `profiles` a clientes
-- Fecha: 2026-11-09
--
-- ESTADO: NO EJECUTAR TODAVÍA.
--   Requiere que el cliente ya use:
--     - public.get_my_profile()            (perfil propio: email/teléfono)
--     - public.match_profiles_by_phones()  (contactos por teléfono)
--     - public.get_public_profile(uuid)    (perfil ajeno: sin PII)
--   Ejecutar 10a primero (RPCs). Desplegar el cliente. Luego esto.
--   Runbook de ventana: security-patches/runbooks/10b_window.md
--   (forzar 1.12, verificaciones, Realtime y rollback).
--
-- Qué hace:
--   Quita SELECT de email, phone_number y phone_digits a anon/authenticated.
--   El resto de columnas públicas de `profiles` se mantiene igual
--   (id, name, username, avatar, avatar_url, bio, role, status, etc.).
--   La service_role (servidor) NO se ve afectada.
--
-- Impacto esperado si NO se actualiza el cliente:
--   - device-contacts.ts / contacts.ts / QrScanner.tsx /
--     PhoneSimulator.handleOpenProfile / SupabaseContext / auth.ts
--     fallarán con "permission denied for table profiles" al pedir esas
--     columnas.
-- ============================================================

-- ------------------------------------------------------------
-- CHECKLIST DE CLIENTE (antes de ejecutar este archivo)
-- ------------------------------------------------------------
-- 1) src/contexts/SupabaseContext.tsx:559 y :1087
--      reemplazar:
--        supabase.from("profiles").select("id,name,email,...").eq("id", userId).single()
--      por:
--        supabase.rpc("get_my_profile")   // devuelve array; usar data?.[0]
--
-- 2) src/services/auth.ts:312 (getCurrentProfile)
--      usar supabase.rpc("get_my_profile").
--
-- 3) src/services/auth.ts:30 (PROFILE_PUBLIC_COLUMNS)
--      quitar `email` y `phone_number` de la lista pública. El perfil propio
--      ya sale de get_my_profile(); el ajeno sale de get_public_profile().
--
-- 4) src/services/device-contacts.ts:110 y :151
--      reemplazar el `.from("profiles").select("...phone_number...").or(...)`
--      por:
--        supabase.rpc("match_profiles_by_phones", { p_phones: batch })
--      El resultado trae `matched_phone` (número de la agenda que hizo match),
--      no el teléfono almacenado de terceros. Mapear matched_phone -> phone.
--
-- 5) src/services/contacts.ts:24-49 (searchUsers)
--      búsqueda por dígitos: usar match_profiles_by_phones().
--      búsqueda por username/name: mantener el SELECT, pero sin phone_number
--      (usar matched_phone si viene de la RPC).
--
-- 6) src/components/QrScanner.tsx:174
--      usar supabase.rpc("get_public_profile", { p_id: userId }).
--      Ya no habrá phone_number; no es necesario para crear el contacto/chat.
--
-- 7) src/components/PhoneSimulator.tsx:3587 (handleOpenProfile)
--      usar get_public_profile(); si se quiere mostrar teléfono, leerlo de la
--      fila de `contacts` del propio usuario (contacts.phone), no de profiles.
--
-- 8) Cualquier UI que muestre `profile.email` o `profile.phone_number` de
--      OTRO usuario debe pasar a mostrar solo datos públicos.
-- ------------------------------------------------------------

BEGIN;

REVOKE SELECT (email, phone_number, phone_digits)
  ON TABLE public.profiles FROM authenticated;

REVOKE SELECT (email, phone_number, phone_digits)
  ON TABLE public.profiles FROM anon;

COMMIT;

-- ============================================================
-- VERIFICACIÓN (debe devolver 0 filas)
-- ============================================================
-- SELECT column_name, privilege_type, grantee
-- FROM information_schema.column_privileges
-- WHERE table_schema = 'public'
--   AND table_name = 'profiles'
--   AND grantee IN ('anon', 'authenticated')
--   AND column_name IN ('email', 'phone_number', 'phone_digits');
--
-- Simulación (rollback): como `authenticated`, esto debe fallar:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
--   SELECT email FROM public.profiles LIMIT 1;  -- permission denied
--   ROLLBACK;

-- ============================================================
-- ROLLBACK (solo si hay que revertir la fase)
-- ============================================================
-- GRANT SELECT (email, phone_number, phone_digits)
--   ON TABLE public.profiles TO authenticated;
-- GRANT SELECT (email, phone_number, phone_digits)
--   ON TABLE public.profiles TO anon;
-- ============================================================
