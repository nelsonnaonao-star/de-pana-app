-- ============================================================
-- FIX — Ocultar real_email y pin de profiles (column-level grants)
-- Hallazgo 1 de la auditoría de fugas de metadatos.
-- Aplicar UNA vez en: Supabase Dashboard → SQL Editor → Run.
-- Idempotente.
-- ============================================================
-- Problema: authenticated tenía SELECT a nivel de tabla sobre
-- profiles → podía leer real_email y pin de CUALQUIER perfil
-- (probado en producción con select('*') de un perfil ajeno).
-- RLS solo filtra filas, no columnas.
-- Solución mínima: revocar el SELECT de tabla y otorgar SELECT
-- SOLO de las columnas públicas que la app consume. La política
-- de filas (USING true) se mantiene intacta → búsqueda, contactos,
-- avatares, grupos, chats y presencia siguen funcionando.
-- El cliente NUNCA pide real_email ni pin por nombre (verificado
-- por grep en src/); el servidor los lee con service_role (bypasa RLS).
-- ============================================================

-- 1) Revocar el SELECT genérico (deja de heredar todas las columnas)
REVOKE SELECT ON TABLE public.profiles FROM anon, authenticated;

-- 2) Otorgar SELECT solo sobre las columnas públicas que la app usa.
--    (incluye email por compatibilidad: no forma parte del hallazgo)
GRANT SELECT (
  id,
  name,
  avatar,
  avatar_url,
  bio,
  role,
  status,
  username,
  phone_number,
  phone_digits,
  display_name,
  chat_style,
  bubble_color,
  partner_bubble_color,
  notif_config,
  auto_reply_config,
  default_story_audience,
  last_active,
  created_at,
  updated_at,
  email
) ON TABLE public.profiles TO authenticated;

-- anon no necesita lectura de profiles (ya estaba denegado en producción);
-- si algún futuro grant reactiva el acceso, este archivo NO lo rehabilita.

-- ============================================================
-- NOTA IMPORTANTE (comportamiento verificado en producción):
-- Con estos grants, un select('*') sobre profiles se DENIEGA con
-- "permission denied for table profiles" (PostgREST/PostgreSQL no
-- expanden * a solo las columnas concedidas). Por eso el cliente
-- DEBE usar listas explícitas de columnas en .select(...), que es
-- lo único que ya hace (ver PROFILE_PUBLIC_COLUMNS en auth.ts).
-- El servidor Express usa service_role y NO se ve afectado.
-- ============================================================

-- ============================================================
-- VERIFICACIÓN (opcional)
-- SELECT column_name FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='profiles'
--     AND grantee='authenticated' AND privilege_type='SELECT'
--     AND column_name IN ('real_email','pin');
--   → NO debe devolver filas.
-- ============================================================