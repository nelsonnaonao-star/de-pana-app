-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Adds the local temp_id correlation column so the Realtime INSERT event can
-- instant-reconcile the optimistic (clock) message with its saved row.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS temp_id text;

-- Index so lookups by temp_id (per chat) are fast during reconciliation.
CREATE INDEX IF NOT EXISTS idx_messages_temp_id ON messages(chat_id, temp_id) WHERE temp_id IS NOT NULL;