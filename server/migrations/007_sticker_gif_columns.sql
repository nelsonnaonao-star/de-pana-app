ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_url text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS gif_url text;
