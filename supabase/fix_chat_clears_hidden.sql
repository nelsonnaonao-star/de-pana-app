-- MIGRACIÓN: Agregar columna hidden a chat_clears para "Eliminar para mí"
-- Ejecutar en Supabase Dashboard > SQL Editor

-- 1. Agregar columna hidden (default false para chats existentes)
ALTER TABLE chat_clears ADD COLUMN IF NOT EXISTS hidden boolean DEFAULT false;

-- 2. Actualizar get_user_chats para excluir chats ocultos Y chats sin mensajes
CREATE OR REPLACE FUNCTION get_user_chats(user_uuid uuid)
RETURNS SETOF chats
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.* FROM public.chats c
  WHERE c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_clears cc
    WHERE cc.chat_id = c.id
      AND cc.user_id = auth.uid()
      AND cc.hidden = true
  )
  AND (
    c.profile_id = auth.uid()
    OR c.admin_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chat_participants cp
      WHERE cp.chat_id = c.id AND cp.profile_id = auth.uid()
    )
  )
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.chat_id = c.id
  )
  ORDER BY c.updated_at DESC;
$$;
