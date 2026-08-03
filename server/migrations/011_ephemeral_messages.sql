-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Adds disappearing (temporary) messages support.
--   messages.is_ephemeral        already exists (server writes it) — kept as-is.
--   messages.ephemeral_expires_at = timestamp when the message must be deleted.
--   chats.ephemeral_timer        = seconds for the chat's default disappearing timer (NULL = off).
-- Timers (seconds): 24h=86400, 7d=604800, 90d=7776000.

ALTER TABLE messages ADD COLUMN IF NOT EXISTS ephemeral_expires_at timestamptz;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS ephemeral_timer integer;

-- Index so the cleanup query is fast (sweep expired messages).
CREATE INDEX IF NOT EXISTS idx_messages_ephemeral_expires ON messages(ephemeral_expires_at) WHERE ephemeral_expires_at IS NOT NULL;

-- ─── Cleanup helper: permanently deletes expired ephemeral messages ───────────
-- Call it from a scheduled job (pg_cron) or on-demand from the server:
--   SELECT purge_expired_ephemeral_messages();
CREATE OR REPLACE FUNCTION purge_expired_ephemeral_messages()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM messages
  WHERE is_ephemeral = true
    AND ephemeral_expires_at IS NOT NULL
    AND ephemeral_expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
