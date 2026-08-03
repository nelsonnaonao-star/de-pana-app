-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Adds poll support columns to the existing messages table.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_question TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS poll_options TEXT;
