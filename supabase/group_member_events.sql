-- ============================================================
-- EXPULSIÓN DE GRUPO — Tabla de eventos dirigidos
-- Idempotente. Ejecutar UNA vez en: Supabase Dashboard → SQL Editor → Run.
--
-- Propósito: el servidor inserta aquí los eventos dirigidos al usuario:
--   'removed' → fue expulsado del grupo (el chat queda visible en solo-lectura)
--   'added'   → fue agregado al grupo (el cliente pregunta si permanece)
-- El cliente se suscribe con Realtime (nivel de fila: user_id = auth.uid()).
--
-- NO modifica ninguna policy existente de otras tablas.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.group_member_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  chat_id    uuid NOT NULL,
  type       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT group_member_events_type_check CHECK (type IN ('removed', 'added'))
);

-- ============================================================
-- FIX para bases existentes: reemplaza el CHECK antiguo
-- (type IN ('removed')) por el nuevo. Idempotente.
-- ============================================================
ALTER TABLE public.group_member_events DROP CONSTRAINT IF EXISTS group_member_events_type_check;
ALTER TABLE public.group_member_events
  ADD CONSTRAINT group_member_events_type_check CHECK (type IN ('removed', 'added'));

-- RLS habilitada (sin esto Realtime no filtra por fila).
ALTER TABLE public.group_member_events ENABLE ROW LEVEL SECURITY;

-- INSERT: solo service_role (el servidor Express). El frontend nunca escribe.
CREATE POLICY "gme_insert_service_role" ON public.group_member_events
  FOR INSERT TO service_role WITH CHECK (true);

-- SELECT: cada usuario autenticado solo puede ver SUS propios eventos.
CREATE POLICY "gme_select_own" ON public.group_member_events
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- UPDATE/DELETE: denegado explícitamente al usuario autenticado.
CREATE POLICY "gme_no_update" ON public.group_member_events
  FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "gme_no_delete" ON public.group_member_events
  FOR DELETE TO authenticated USING (false);

-- ============================================================
-- Realtime: agregar la tabla a la publicación supabase_realtime.
-- Equivale a activar Suabase Dashboard → Database → Replication.
-- Idempotente y NO modifica las otras tablas de la publicación.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'group_member_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_member_events;
    END IF;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;