-- ============================================================
-- PARCHE 11 - Cerrar tablas legacy abiertas y privilegios de `anon`
-- Fecha: 2026-11-09
-- Proyecto verificado: akgsylutbpgolurkcavh
--
-- ESTADO: se puede ejecutar YA. Es reversible (ver ROLLBACK).
--
-- Hallazgos verificados en producción:
--   - Tablas con policies `ALL USING (true) WITH CHECK (true)` para `public`
--     (incluye anon): encuestas, votos, polls, poll_options, poll_votes,
--     message_reactions, momento_reactions, momento_views, reactions,
--     stickers, tienda_stickers, sticker_packs.
--     Estaban VACÍAS (0 filas) salvo call_signals.
--   - `call_signals`: 423 filas (jun-2026) con payloads SDP/ICE; policies
--     `authenticated_select/insert true`. El cliente actual ya NO usa esta
--     tabla (usa Supabase Realtime broadcast). Queda inaccesible al cliente.
--   - `contacts`: `anon` tenía GRANT ALL (incluido TRUNCATE). RLS ya lo
--     bloqueaba por fila, pero TRUNCATE no pasa por RLS: se revoca.
--
-- Qué hace:
--   1) Elimina TODAS las policies de las tablas legacy (deny-by-default).
--   2) Revoca todos los privilegios de anon/authenticated sobre ellas.
--   3) Revoca todos los privilegios de anon sobre `contacts`.
--   La service_role (servidor) conserva acceso (bypassa RLS).
--
-- No borra datos. Para borrar tablas, ver bloque final (comentado).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Quitar policies permisivas de las tablas legacy
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, p.polname AS pol
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'encuestas', 'votos',
        'polls', 'poll_options', 'poll_votes',
        'message_reactions', 'reactions',
        'momento_reactions', 'momento_views',
        'stickers', 'tienda_stickers', 'sticker_packs',
        'call_signals'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.pol, r.tbl);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2) Revocar privilegios de cliente sobre las tablas legacy
-- ------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE
  public.encuestas,
  public.votos,
  public.polls,
  public.poll_options,
  public.poll_votes,
  public.message_reactions,
  public.reactions,
  public.momento_reactions,
  public.momento_views,
  public.stickers,
  public.tienda_stickers,
  public.sticker_packs,
  public.call_signals
FROM anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE
  public.encuestas,
  public.votos,
  public.polls,
  public.poll_options,
  public.poll_votes,
  public.message_reactions,
  public.reactions,
  public.momento_reactions,
  public.momento_views,
  public.stickers,
  public.tienda_stickers,
  public.sticker_packs,
  public.call_signals
TO service_role;

-- ------------------------------------------------------------
-- 3) `contacts`: anon no necesita NADA (evita TRUNCATE/REFERENCES/TRIGGER)
-- ------------------------------------------------------------
REVOKE ALL PRIVILEGES ON TABLE public.contacts FROM anon;

COMMIT;

-- ============================================================
-- VERIFICACIÓN
-- ============================================================
-- 1) No deben quedar policies en las tablas legacy:
--   SELECT tablename, count(*) AS policies
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN ('encuestas','votos','polls','poll_options','poll_votes',
--                       'message_reactions','reactions','momento_reactions',
--                       'momento_views','stickers','tienda_stickers',
--                       'sticker_packs','call_signals')
--   GROUP BY tablename ORDER BY tablename;
--   -- (no debe devolver filas)
--
-- 2) `anon` no debe tener privilegios en `contacts`:
--   SELECT privilege_type FROM information_schema.role_table_grants
--   WHERE table_schema='public' AND table_name='contacts' AND grantee='anon';
--   -- (no debe devolver filas)
--
-- 3) `authenticated` ya no accede a call_signals:
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SELECT set_config('request.jwt.claims',
--     '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
--   SELECT count(*) FROM public.call_signals;  -- permission denied
--   ROLLBACK;

-- ============================================================
-- ROLLBACK (revertir a estado anterior)
-- ============================================================
-- GRANT ALL PRIVILEGES ON TABLE public.contacts TO anon;
-- -- Las policies NO se recrean aquí. Si se necesitan, reaplicar los SQL de
-- -- creación originales (no recomendado: son las policies inseguras).
-- ============================================================

-- ============================================================
-- FUTURO (NO EJECUTAR SIN BACKUP): borrar las tablas legacy.
-- Requiere exportar call_signals antes (son ~423 filas de jun-2026).
-- Orden respetando claves foráneas:
-- ============================================================
-- -- Backup sugerido (server-side, service_role):
-- --   \copy (select * from public.call_signals) to 'call_signals_backup.csv' csv header
-- DROP TABLE IF EXISTS public.votos;
-- DROP TABLE IF EXISTS public.encuestas;
-- DROP TABLE IF EXISTS public.poll_votes;
-- DROP TABLE IF EXISTS public.poll_options;
-- DROP TABLE IF EXISTS public.polls;
-- DROP TABLE IF EXISTS public.message_reactions;
-- DROP TABLE IF EXISTS public.reactions;
-- DROP TABLE IF EXISTS public.momento_reactions;
-- DROP TABLE IF EXISTS public.momento_views;
-- DROP TABLE IF EXISTS public.stickers;
-- DROP TABLE IF EXISTS public.tienda_stickers;
-- DROP TABLE IF EXISTS public.sticker_packs;
-- DROP TABLE IF EXISTS public.call_signals;
