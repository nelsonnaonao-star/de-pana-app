-- ============================================================
-- PARCHE 10a - RPCs seguras de perfiles (FASE A: ADITIVA, SEGURA)
-- Fecha: 2026-11-09
-- Proyecto verificado: akgsylutbpgolurkcavh
--
-- ESTADO: se puede ejecutar YA. No revoca nada ni rompe clientes.
--
-- Qué hace:
--   1) get_my_profile(): devuelve el perfil COMPLETO del usuario autenticado
--      (incluye email y teléfono propios) sin exponer esas columnas al resto.
--   2) match_profiles_by_phones(): empareja contactos de la agenda con perfiles
--      por teléfono, devolviendo SOLO campos públicos. Nunca devuelve el
--      teléfono almacenado de terceros: devuelve el número de entrada que hizo
--      match (que el cliente ya tenía en su agenda).
--
-- Por qué:
--   Hoy `profiles_select_all_auth USING (true)` + GRANT SELECT(email,
--   phone_number, phone_digits) permiten que CUALQUIER cuenta lea el correo y
--   teléfono de TODOS los perfiles (verificado en producción: 42 perfiles).
--
-- Después de ejecutar esto:
--   - Desplegar el cliente usando estas RPC (ver checklist en 10b).
--   - Recién entonces ejecutar 10b_profiles_pii_revoke.sql.
--
-- Idempotente: usa CREATE OR REPLACE y REVOKE/GRANT repetibles.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Perfil propio (16 columnas que ya consume el cliente)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  id uuid,
  name text,
  email text,
  avatar text,
  avatar_url text,
  bio text,
  role text,
  status text,
  phone_number text,
  username text,
  bubble_color text,
  partner_bubble_color text,
  notif_config jsonb,
  default_story_audience text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id,
    p.name,
    p.email,
    p.avatar,
    p.avatar_url,
    p.bio,
    p.role,
    p.status,
    p.phone_number,
    p.username,
    p.bubble_color,
    p.partner_bubble_color,
    p.notif_config,
    p.default_story_audience,
    p.created_at,
    p.updated_at
  FROM public.profiles p
  WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- ------------------------------------------------------------
-- 2) Emparejar contactos por teléfono (sin filtrar teléfonos ajenos)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.match_profiles_by_phones(
  p_phones text[],
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  name text,
  username text,
  avatar_url text,
  bio text,
  matched_phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH inputs AS (
    SELECT DISTINCT regexp_replace(coalesce(x, ''), '[^0-9]', '', 'g') AS digits
    FROM unnest(coalesce(p_phones, ARRAY[]::text[])) AS x
    WHERE length(regexp_replace(coalesce(x, ''), '[^0-9]', '', 'g')) >= 7
  ),
  candidates AS (
    SELECT
      i.digits,
      right(i.digits, 10) AS last10,
      right(i.digits, 7)  AS last7
    FROM inputs i
  ),
  matches AS (
    SELECT
      p.id,
      p.name,
      p.username,
      p.avatar_url,
      p.bio,
      c.digits AS matched_phone,
      -- Mejor coincidencia: entrada contiene al almacenado > últimos 10 > 7.
      CASE
        WHEN p.phone_digits IS NOT NULL
         AND length(p.phone_digits) >= 7
         AND c.digits LIKE '%' || p.phone_digits THEN 1
        WHEN p.phone_digits LIKE '%' || c.last10 THEN 2
        WHEN p.phone_digits LIKE '%' || c.last7  THEN 3
        ELSE 4
      END AS score
    FROM candidates c
    JOIN public.profiles p
      ON p.phone_digits IS NOT NULL
     AND (
          (length(p.phone_digits) >= 7 AND c.digits LIKE '%' || p.phone_digits)
       OR p.phone_digits LIKE '%' || c.last10
       OR p.phone_digits LIKE '%' || c.last7
     )
    WHERE auth.uid() IS NOT NULL
  ),
  ranked AS (
    SELECT *,
           row_number() OVER (
             PARTITION BY id
             ORDER BY score, length(matched_phone) DESC
           ) AS rn
    FROM matches
  )
  SELECT id, name, username, avatar_url, bio, matched_phone
  FROM ranked
  WHERE rn = 1
  ORDER BY id
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.match_profiles_by_phones(text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.match_profiles_by_phones(text[], integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.match_profiles_by_phones(text[], integer) TO authenticated;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- 1) Las funciones existen y solo `authenticated`/service_role las ejecutan:
--   SELECT p.proname,
--          array_to_string(array(
--            SELECT r.rolname FROM aclexplode(p.proacl) a
--            JOIN pg_roles r ON r.oid = a.grantee
--            WHERE a.privilege_type = 'EXECUTE'
--          ), ',') AS grantees
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public'
--     AND p.proname IN ('get_my_profile', 'match_profiles_by_phones');
--
-- 2) Simulación (rollback) del perfil propio:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"<UUID_DE_UN_PERFIL>","role":"authenticated"}', true);
--   SELECT * FROM public.get_my_profile();
--   ROLLBACK;
-- ============================================================
