-- ============================================================
-- FIX: chat 1:1 no se crea ("new row violates row-level security")
-- Causa: las políticas de INSERT de la tabla chats se dropearon
-- en la limpieza de fix_rls.sql y no quedó ninguna que permita
-- crear chats 1:1. Aquí se recrean (idempotente).
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

-- Función auxiliar por si no existe (las políticas la usan)
CREATE OR REPLACE FUNCTION public.user_in_chat(chat_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_uuid
    AND c.deleted_at IS NULL
    AND (
      c.profile_id = user_uuid
      OR c.admin_id = user_uuid
      OR EXISTS (
        SELECT 1 FROM chat_participants cp
        WHERE cp.chat_id = c.id AND cp.profile_id = user_uuid
      )
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.user_in_chat(uuid, uuid) TO authenticated, anon;

-- ── CHATS: políticas de INSERT ─────────────────────────────
-- Permite el chat 1:1 donde el usuario es uno de los dos extremos
DROP POLICY IF EXISTS "chats_insert_1to1" ON chats;
CREATE POLICY "chats_insert_1to1" ON chats
  FOR INSERT TO authenticated
  WITH CHECK (
    (profile_id = auth.uid() OR admin_id = auth.uid())
    AND is_group = false
  );

-- Permite crear grupos donde el usuario es admin
DROP POLICY IF EXISTS "chats_insert_group" ON chats;
CREATE POLICY "chats_insert_group" ON chats
  FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid() AND is_group = true);

-- ── Verificación ───────────────────────────────────────────
SELECT polname, cmd, with_check
FROM pg_policy
WHERE polrelid = 'public.chats'::regclass
  AND cmd = 'INSERT';