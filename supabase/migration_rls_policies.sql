-- ============================================================
-- RLS Policies for RED ON (DE PANA)
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================
-- The server uses supabaseAdmin (service_role key) which
-- bypasses RLS entirely. These policies protect against
-- direct client-side access via the user's JWT.
-- ============================================================

-- ─── PROFILES ────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read any profile (needed for contacts, chat names, avatars)
CREATE POLICY "profiles_select_auth"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (signup flow)
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);


-- ─── CHATS ───────────────────────────────────────────────────────
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- Users can see chats where they are a direct participant (profile_id or admin_id)
CREATE POLICY "chats_select_direct"
  ON chats FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id OR auth.uid() = admin_id);

-- Users can see group chats where they are in chat_participants
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

-- Users can only create chats where they are profile_id or admin_id
CREATE POLICY "chats_insert_own"
  ON chats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = profile_id OR auth.uid() = admin_id);

-- Users can only update chats where they are a participant
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

-- Users can see participants for chats they belong to
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

-- Users can add participants to chats they belong to
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

-- Users can remove participants from chats they own (or remove themselves)
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

-- Users can read messages in chats they belong to
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

-- Users can send messages (sender_id must match their UID) to chats they belong to
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

-- Users can update messages in chats they belong to (for reactions, read_by, status)
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

-- Users can only see their own contacts
CREATE POLICY "contacts_select_own"
  ON contacts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can only insert their own contacts
CREATE POLICY "contacts_insert_own"
  ON contacts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own contacts
CREATE POLICY "contacts_update_own"
  ON contacts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own contacts
CREATE POLICY "contacts_delete_own"
  ON contacts FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- ─── CALLS ───────────────────────────────────────────────────────
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Users can see calls where they are caller or receiver
CREATE POLICY "calls_select_own"
  ON calls FOR SELECT
  TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id);

-- Users can create calls where they are the caller
CREATE POLICY "calls_insert_own"
  ON calls FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = caller_id);

-- Users can update calls where they are a participant (for status changes)
CREATE POLICY "calls_update_participant"
  ON calls FOR UPDATE
  TO authenticated
  USING (auth.uid() = caller_id OR auth.uid() = receiver_id)
  WITH CHECK (true);


-- ============================================================
-- SERVER-ONLY TABLES: RLS enabled, NO policies = blocked
-- These tables are only accessed via supabaseAdmin (service_role)
-- which bypasses RLS. No client access needed.
-- ============================================================

ALTER TABLE password_reset_codes ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE exchange_rates ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE broadcast_channels ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE broadcast_subscribers ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE channel_update_reactions ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied

ALTER TABLE business_flyers ENABLE ROW LEVEL SECURITY;
-- No policies = all client access denied


-- ============================================================
-- CHAT_CLEARS: per-user "hide messages" (replaces shared is_deleted)
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_clears (
  chat_id   uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cleared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, user_id)
);

ALTER TABLE chat_clears ENABLE ROW LEVEL SECURITY;

-- Users can read their own clears
CREATE POLICY "chat_clears_select_own"
  ON chat_clears FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own clears
CREATE POLICY "chat_clears_insert_own"
  ON chat_clears FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own clears (re-clear with newer timestamp)
CREATE POLICY "chat_clears_update_own"
  ON chat_clears FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_chat_clears_user ON chat_clears(user_id);


-- ============================================================
-- TRIGGER: protect sensitive message columns from direct client updates
-- Only service_role (server) can modify sender_id, chat_id, text, is_deleted.
-- The server uses supabaseAdmin (service_role) which sets
--   current_setting('role') = 'service_role'
-- The trigger uses DO $$ ... EXCEPTION WHEN insufficient_privilege $$ to
-- avoid errors when role() returns 'authenticated' (normal client).
-- ============================================================

CREATE OR REPLACE FUNCTION messages_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role bypasses RLS, but the trigger still fires.
  -- Check the session role: only service_role may change protected columns.
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Block changes to immutable columns
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot modify sender_id';
  END IF;
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
    RAISE EXCEPTION 'Cannot modify chat_id';
  END IF;

  -- Block direct client soft-delete or text overwrite
  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    RAISE EXCEPTION 'Cannot soft-delete messages directly';
  END IF;
  IF NEW.text IS DISTINCT FROM OLD.text AND OLD.text IS NOT NULL AND NEW.text IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit messages directly';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists, then create
DROP TRIGGER IF EXISTS guard_sensitive_message_fields ON messages;

CREATE TRIGGER guard_sensitive_message_fields
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_guard_sensitive_fields();
