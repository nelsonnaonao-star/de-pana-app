-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Creates the push_tokens table for FCM push notification tokens

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  token TEXT NOT NULL,
  device TEXT DEFAULT 'android-fcm',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profile_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_profile_id ON push_tokens(profile_id);
