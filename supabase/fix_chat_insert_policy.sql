-- ============================================================
-- FIX: chat 1:1 no se crea ("new row violates row-level security")
-- Causa: las políticas de INSERT de la tabla chats se dropearon
-- en la limpieza de fix_rls.sql y no quedó ninguna que permita
-- crear chats 1:1. Aquí se recrean (idempotente).
-- Run in: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

-- NOTA DE SEGURIDAD (hardening):
--   Este script NO redefine public.user_in_chat. Esa función debe permanecer
--   SIEMPRE en su versión endurecida (auth.uid(), SECURITY DEFINER,
--   search_path=public) definida en security_hardening_v1.sql / phase1_security.sql.
--   Redefinirla aquí con el parámetro user_uuid del cliente y conceder EXECUTE
--   a anon reintroduciría la regresión de autorización.
--   Las políticas de INSERT de chats de abajo NO usan user_in_chat; sólo
--   asumen que la función endurecida ya existe.

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