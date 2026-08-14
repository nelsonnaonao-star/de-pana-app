-- Adds the columns that the app's addContact() writes to the contacts table.
-- The app also retries with a minimal payload when these columns are missing,
-- so this migration is optional but enables full contact functionality
-- (favorites, custom color themes, groups).
-- Run this SQL in your Supabase Dashboard > SQL Editor.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'human';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS color_theme TEXT DEFAULT '';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN DEFAULT FALSE;