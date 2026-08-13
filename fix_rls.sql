-- ============================================================
-- FIX RLS FINAL: elimina recursión infinita y políticas rotas
-- en chats, chat_participants, messages, profiles y app_errors.
-- (Aplicado también vía Management API; se deja documentado.)
-- ============================================================

-- ============================================================
-- 1) FUNCIONES SECURITY DEFINER (DEBEN CREARSE ANTES QUE LAS POLÍTICAS)
-- ============================================================

-- Verifica si un usuario participa en un chat (1:1 por profile/admin o miembro de grupo)
CREATE OR REPLACE FUNCTION user_in_chat(chat_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
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

GRANT EXECUTE ON FUNCTION user_in_chat(uuid, uuid) TO authenticated, anon, service_role;

-- Nota: is_chat_member(chat_id uuid, user_id uuid) ya existe en la BD con
-- SECURITY DEFINER y no se toca (las políticas nuevas usan user_in_chat).

-- Lista de chats del usuario (incluye grupos donde solo es participante)
CREATE OR REPLACE FUNCTION get_user_chats(user_uuid uuid)
RETURNS SETOF chats
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.* FROM chats c
  WHERE c.deleted_at IS NULL
  AND (
    c.profile_id = user_uuid
    OR c.admin_id = user_uuid
    OR EXISTS (
      SELECT 1 FROM chat_participants cp
      WHERE cp.chat_id = c.id AND cp.profile_id = user_uuid
    )
  )
  ORDER BY c.updated_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO authenticated, anon, service_role;

-- Mensajes de un chat donde el usuario participa
CREATE OR REPLACE FUNCTION get_user_messages(chat_uuid uuid, user_uuid uuid)
RETURNS SETOF messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.* FROM messages m
  WHERE m.chat_id = chat_uuid
  AND EXISTS (
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
  )
  ORDER BY m.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION get_user_messages(uuid, uuid) TO authenticated, anon, service_role;

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

-- ============================================================
-- 2) ELIMINAR TODAS LAS POLÍTICAS EXISTENTES (todas las generaciones)
-- ============================================================

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
      AND c.relname IN ('chats', 'chat_participants', 'messages', 'profiles', 'app_errors')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.pol, r.tbl);
  END LOOP;
END $$;

-- ============================================================
-- 3) POLÍTICAS NUEVAS (SIN RECURSIÓN)
-- ============================================================

-- ── PROFILES ─────────────────────────────────────────────
-- Cualquier usuario puede leer perfiles (búsqueda por teléfono/username)
CREATE POLICY "profiles_select_all" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ── CHATS ────────────────────────────────────────────────
CREATE POLICY "chats_select_member" ON chats
  FOR SELECT USING (user_in_chat(id, auth.uid()));

-- Permite self-chats (chat de soporte con profile_id = admin_id = auth.uid())
-- y 1:1 donde el creador es uno de los dos extremos.
CREATE POLICY "chats_insert_1to1" ON chats
  FOR INSERT WITH CHECK (
    (profile_id = auth.uid() OR admin_id = auth.uid())
    AND is_group = false
  );

CREATE POLICY "chats_insert_group" ON chats
  FOR INSERT WITH CHECK (admin_id = auth.uid() AND is_group = true);

CREATE POLICY "chats_update_participant" ON chats
  FOR UPDATE USING (user_in_chat(id, auth.uid()));

CREATE POLICY "chats_delete_admin" ON chats
  FOR DELETE USING (admin_id = auth.uid());

-- ── CHAT_PARTICIPANTS ────────────────────────────────────
CREATE POLICY "participants_select_own" ON chat_participants
  FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "participants_insert_self" ON chat_participants
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "participants_insert_admin" ON chat_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
      AND chats.admin_id = auth.uid()
      AND chats.is_group = true
    )
  );

CREATE POLICY "participants_delete_self" ON chat_participants
  FOR DELETE USING (profile_id = auth.uid());

CREATE POLICY "participants_delete_admin" ON chat_participants
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
      AND chats.admin_id = auth.uid()
    )
  );

-- ── MESSAGES ─────────────────────────────────────────────
CREATE POLICY "messages_select_member" ON messages
  FOR SELECT USING (user_in_chat(chat_id, auth.uid()));

CREATE POLICY "messages_insert_member" ON messages
  FOR INSERT WITH CHECK (
    sender_id = auth.uid()
    AND user_in_chat(chat_id, auth.uid())
  );

CREATE POLICY "messages_update_own" ON messages
  FOR UPDATE USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

CREATE POLICY "messages_delete_own" ON messages
  FOR DELETE USING (sender_id = auth.uid());

-- ── APP_ERRORS ───────────────────────────────────────────
CREATE POLICY "errors_insert_own" ON app_errors
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "errors_select_own" ON app_errors
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- 4) ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_chats_profile_admin ON chats(profile_id, admin_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_profile ON chat_participants(profile_id);
CREATE INDEX IF NOT EXISTS idx_chat_participants_chat ON chat_participants(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_app_errors_user ON app_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_chats_deleted_at ON chats(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================
-- 5) TRIGGERS updated_at
-- ============================================================

DROP TRIGGER IF EXISTS set_updated_at ON chats;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON chats FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON messages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON profiles;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
