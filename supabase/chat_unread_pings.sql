-- ============================================================
-- CHAT UNREAD PINGS — no-leídos realtime para miembros de grupo
-- Fecha: 2026-09-08
--
-- POR QUÉ: Realtime sobre `chats` solo llega a profile_id/admin_id
--   (= creador del grupo). Los demás miembros nunca reciben el
--   UPDATE de `chats` y dependían 100% del push FCM. Esta tabla
--   es un "ping" por (chat, usuario) que el servidor inserta al
--   mandar un mensaje grupal; cada miembro escucha sus propios
--   pings por realtime y así el badge de no-leídos se actualiza
--   sin depender de FCM.
--
-- INSTRUCCIONES:
--   Ejecutar UNA SOLA VEZ en el Dashboard de Supabase (SQL Editor).
--   No requiere reiniciar la app. Es idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chat_unread_pings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_unread_pings_user_idx
  ON public.chat_unread_pings (user_id, created_at DESC);

-- RLS: cada usuario solo ve/borra sus propios pings. El servidor
-- inserta con service_role (bypasa RLS).
ALTER TABLE public.chat_unread_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_unread_pings_select_own" ON public.chat_unread_pings;
CREATE POLICY "chat_unread_pings_select_own"
  ON public.chat_unread_pings FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "chat_unread_pings_delete_own" ON public.chat_unread_pings;
CREATE POLICY "chat_unread_pings_delete_own"
  ON public.chat_unread_pings FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Realtime: exponer la tabla a postgres_changes.
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_unread_pings;

-- Limpieza: borra pings con más de 48h (evita crecimiento infinito).
DROP FUNCTION IF EXISTS public.cleanup_old_chat_unread_pings();
CREATE FUNCTION public.cleanup_old_chat_unread_pings()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.chat_unread_pings
  WHERE created_at < now() - interval '48 hours';
$$;