-- FIX: Frontera cleared_at en get_user_messages
-- Ejecutar en Supabase Dashboard > SQL Editor
-- Restaura la función get_user_messages con filtro por chat_clears.cleared_at

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_user_messages'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION get_user_messages(
  chat_uuid uuid,
  user_uuid uuid,
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL,
  p_after  timestamptz DEFAULT NULL
)
RETURNS SETOF messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT m.* FROM public.messages m
    WHERE m.chat_id = chat_uuid
    AND (m.is_deleted = false OR m.is_deleted IS NULL)
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_uuid
      AND c.deleted_at IS NULL
      AND (
        c.profile_id = auth.uid()
        OR c.admin_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.chat_participants cp
          WHERE cp.chat_id = c.id AND cp.profile_id = auth.uid()
        )
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_clears cc
      WHERE cc.chat_id = m.chat_id
        AND cc.user_id = auth.uid()
        AND cc.cleared_at IS NOT NULL
        AND m.created_at <= cc.cleared_at
    )
    AND (p_after  IS NULL OR m.created_at > p_after)
    AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT p_limit
  ) t
  ORDER BY t.created_at ASC, t.id ASC;
$$;

REVOKE EXECUTE ON FUNCTION get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) FROM anon, public;
GRANT EXECUTE ON FUNCTION get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) TO authenticated;
