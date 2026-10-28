-- ============================================================
-- ⚠️ HISTÓRICO / NO EJECUTAR ⚠️
-- RLS FIX — v4 (recursión infinita en políticas)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================
-- Sustituido por supabase/phase1_security.sql y
-- supabase/fix_participants_insert_self_v1.sql.
-- Reintroduce políticas inseguras:
--   * profiles_select_anon_auth permite SELECT a anon.
--   * chat_participants_insert_own_chat permite a un miembro añadir a otros.
--   * chat_participants_delete_own_or_self permite a un miembro expulsar a otros.
-- Se conserva solo como referencia. El GUARD de abajo aborta su ejecución.
--
-- Problema: las políticas de chats, chat_participants y messages
-- se referencian entre sí en ciclo (chats->chat_participants->chats),
-- causando "infinite recursion detected in policy".
-- Solución: función SECURITY DEFINER (corre como dueño, ignora RLS)
-- que comprueba la pertenencia a un chat. Se conserva como referencia histórica.
-- ============================================================

-- GUARD TÉCNICO: abortar si alguien ejecuta este archivo por error.
DO $$
BEGIN
  RAISE EXCEPTION 'Script histórico: no ejecutar migration_rls_fix_v4.sql. Usar phase1_security.sql y fix_participants_insert_self_v1.sql.';
END;
$$;

-- ─── FUNCIÓN AYUDA (rompe el ciclo) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_chat_member(chat_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_id
      AND (c.profile_id = user_id OR c.admin_id = user_id)
  ) OR EXISTS (
    SELECT 1 FROM public.chat_participants cp
    WHERE cp.chat_id = chat_id
      AND cp.profile_id = user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) TO authenticated;


-- ─── PROFILES (directorio público: anónimos pueden leer, solo el dueño escribe) ──
DROP POLICY IF EXISTS "profiles_select_auth" ON profiles;
CREATE POLICY "profiles_select_anon_auth"
  ON profiles FOR SELECT
  TO anon, authenticated
  USING (true);


-- ─── CHATS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "chats_select_group" ON chats;
CREATE POLICY "chats_select_group"
  ON chats FOR SELECT
  TO authenticated
  USING (public.is_chat_member(id, auth.uid()));

DROP POLICY IF EXISTS "chats_update_participant" ON chats;
CREATE POLICY "chats_update_participant"
  ON chats FOR UPDATE
  TO authenticated
  USING (public.is_chat_member(id, auth.uid()))
  WITH CHECK (public.is_chat_member(id, auth.uid()));


-- ─── CHAT_PARTICIPANTS ───────────────────────────────────────────
DROP POLICY IF EXISTS "chat_participants_select_own_chat" ON chat_participants;
CREATE POLICY "chat_participants_select_own_chat"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (public.is_chat_member(chat_id, auth.uid()));

DROP POLICY IF EXISTS "chat_participants_insert_own_chat" ON chat_participants;
CREATE POLICY "chat_participants_insert_own_chat"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (public.is_chat_member(chat_id, auth.uid()));

DROP POLICY IF EXISTS "chat_participants_delete_own_or_self" ON chat_participants;
CREATE POLICY "chat_participants_delete_own_or_self"
  ON chat_participants FOR DELETE
  TO authenticated
  USING (public.is_chat_member(chat_id, auth.uid()));


-- ─── MESSAGES ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_select_member" ON messages;
CREATE POLICY "messages_select_member"
  ON messages FOR SELECT
  TO authenticated
  USING (public.is_chat_member(chat_id, auth.uid()));

DROP POLICY IF EXISTS "messages_insert_own" ON messages;
CREATE POLICY "messages_insert_own"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.is_chat_member(chat_id, auth.uid())
  );

DROP POLICY IF EXISTS "messages_update_member" ON messages;
CREATE POLICY "messages_update_member"
  ON messages FOR UPDATE
  TO authenticated
  USING (public.is_chat_member(chat_id, auth.uid()))
  WITH CHECK (public.is_chat_member(chat_id, auth.uid()));


-- ============================================================
-- DONE
-- ============================================================
