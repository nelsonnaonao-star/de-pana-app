-- FIX 3: Excluir mensajes eliminados del RPC get_user_messages
-- Ejecutar en Supabase Dashboard > SQL Editor

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
    AND (m.is_deleted IS NULL OR m.is_deleted = false)
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
    AND (p_after  IS NULL OR m.created_at > p_after)
    AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT p_limit
  ) t
  ORDER BY t.created_at ASC, t.id ASC;
$$;
