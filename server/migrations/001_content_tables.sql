-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Only creates tables that DON'T already exist in the database.
-- Existing tables (stories, broadcast_channels, broadcast_subscribers, broadcast_messages) are used as-is.

-- Channel update reactions (for broadcast_messages)
CREATE TABLE IF NOT EXISTS channel_update_reactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  update_id UUID REFERENCES broadcast_messages(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'fire', 'heart')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(update_id, user_id)
);

-- Business Flyers (promotional flyers — 100% new functionality, no equivalent in existing DB)
CREATE TABLE IF NOT EXISTS business_flyers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  flyer_url TEXT,
  template_id TEXT,
  product_name TEXT,
  price TEXT,
  music_url TEXT,
  music_name TEXT,
  views INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_update_reactions_update_id ON channel_update_reactions(update_id);
CREATE INDEX IF NOT EXISTS idx_business_flyers_user_id ON business_flyers(user_id);
