-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Adds audience (visibility) support to stories + a per-user default preference.
-- audience: JSON string, e.g. {"tipo":"todos","ids":[]}
--   tipo: "todos" (all mutual contacts) | "solo" (only listed ids) | "ocultar" (all mutual except listed ids) | "nadie"
ALTER TABLE stories ADD COLUMN IF NOT EXISTS audience TEXT DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS default_story_audience TEXT DEFAULT NULL;
