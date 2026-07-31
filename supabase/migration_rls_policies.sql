-- ============================================================
-- RLS Policies for RED ON (DE PANA) — v2 (idempotente)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================
-- Enables Row Level Security + policies so each user only
-- sees/edits THEIR OWN data. Server keeps using supabaseAdmin
-- (service_role) which bypasses RLS entirely.
-- Safe to run multiple times.
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_auth" ON profiles;
CREATE POLICY "profiles_select_auth"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);


-- ─── CHATS ───────────────────────────────────────────────────────
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_select_direct" ON chats;
CREATE POLICY "chats_select_direct"
  ON chats FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id OR auth.uid() = admin_id);

DROP POLICY IF EXISTS "chats_select_group" ON chats;
CREATE POLICY "chats_select_group"
  ON chats FOR SELECT
  TO authenticated
  USING (
    is_group = true
    AND EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chats.id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chats_insert_own" ON chats;
CREATE POLICY "chats_insert_own"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id OR auth.uid() = admin_id);

DROP POLICY IF EXISTS "chats_update_participant" ON chats;
CREATE POLICY "chats_update_participant"
  ON chats FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = profile_id
    OR auth.uid() = admin_id
    OR (
      is_group = true
      AND EXISTS (
        SELECT 1 FROM chat_participants
        WHERE chat_participants.chat_id = chats.id
          AND chat_participants.profile_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    auth.uid() = profile_id
    OR auth.uid() = admin_id
    OR (
      is_group = true
      AND EXISTS (
        SELECT 1 FROM chat_participants
        WHERE chat_participants.chat_id = chats.id
          AND chat_participants.profile_id = auth.uid()
      )
    )
  );


-- ─── CHAT_PARTICIPANTS ───────────────────────────────────────────
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_participants_select_own_chat" ON chat_participants;
CREATE POLICY "chat_participants_select_own_chat"
  ON chat_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
        AND (
          chats.profile_id = auth.uid()
          OR chats.admin_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM chat_participants cp2
      WHERE cp2.chat_id = chat_participants.chat_id
        AND cp2.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_participants_insert_own_chat" ON chat_participants;
CREATE POLICY "chat_participants_insert_own_chat"
  ON chat_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
        AND (
          chats.profile_id = auth.uid()
          OR chats.admin_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "chat_participants_delete_own_or_self" ON chat_participants;
CREATE POLICY "chat_participants_delete_own_or_self"
  ON chat_participants FOR DELETE
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
        AND (
          chats.profile_id = auth.uid()
          OR chats.admin_id = auth.uid()
        )
    )
  );


-- ─── MESSAGES ────────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_member" ON messages;
CREATE POLICY "messages_select_member"
  ON messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
        AND (
          chats.profile_id = auth.uid()
          OR chats.admin_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "messages_insert_own" ON messages;
CREATE POLICY "messages_insert_own"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      EXISTS (
        SELECT 1 FROM chats
        WHERE chats.id = messages.chat_id
          AND (
            chats.profile_id = auth.uid()
            OR chats.admin_id = auth.uid()
          )
      )
      OR EXISTS (
        SELECT 1 FROM chat_participants
        WHERE chat_participants.chat_id = messages.chat_id
          AND chat_participants.profile_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "messages_update_member" ON messages;
CREATE POLICY "messages_update_member"
  ON messages FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = messages.chat_id
        AND (
          chats.profile_id = auth.uid()
          OR chats.admin_id = auth.uid()
        )
      )
    OR EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = messages.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  )
  WITH CHECK (true);


-- ─── CONTACTS ────────────────────────────────────────────────────
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_select_own" ON contacts;
CREATE POLICY "contacts_select_own"
  ON contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_insert_own" ON contacts;
CREATE POLICY "contacts_insert_own"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_update_own" ON contacts;
CREATE POLICY "contacts_update_own"
  ON contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "contacts_delete_own" ON contacts;
CREATE POLICY "contacts_delete_own"
  ON contacts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ─── CALLS ───────────────────────────────────────────────────────
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calls_select_own" ON calls;
CREATE POLICY "calls_select_own"
  ON calls FOR SELECT
  TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id);

DROP POLICY IF EXISTS "calls_insert_own" ON calls;
CREATE POLICY "calls_insert_own"
  ON calls FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = caller_id);

DROP POLICY IF EXISTS "calls_update_participant" ON calls;
CREATE POLICY "calls_update_participant"
  ON calls FOR UPDATE
  TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = callee_id)
  WITH CHECK (true);


-- ============================================================
-- SERVER-ONLY TABLES: RLS enabled, NO policies = blocked
-- Only accessible via supabaseAdmin (service_role)
-- ============================================================

ALTER TABLE password_reset_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_update_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_flyers ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- CHAT_CLEARS: per-user "hide messages"
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_clears (
  chat_id   uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE chat_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_clears_select_own" ON chat_clears;
CREATE POLICY "chat_clears_select_own"
  ON chat_clears FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_clears_insert_own" ON chat_clears;
CREATE POLICY "chat_clears_insert_own"
  ON chat_clears FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "chat_clears_update_own" ON chat_clears;
CREATE POLICY "chat_clears_update_own"
  ON chat_clears FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_chat_clears_user ON chat_clears(user_id);


-- ============================================================
-- TRIGGER: protect sensitive message columns from direct client updates
-- Only service_role (server) may change sender_id, chat_id, text, is_deleted.
-- ============================================================

CREATE OR REPLACE FUNCTION messages_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot modify sender_id';
  END IF;
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
    RAISE EXCEPTION 'Cannot modify chat_id';
  END IF;

  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    RAISE EXCEPTION 'Cannot soft-delete messages directly';
  END IF;
  IF NEW.text IS DISTINCT FROM OLD.text AND OLD.text IS NOT NULL AND NEW.text IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit messages directly';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sensitive_message_fields ON messages;

CREATE TRIGGER guard_sensitive_message_fields
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_guard_sensitive_fields();

-- ============================================================
-- DONE
-- ============================================================
