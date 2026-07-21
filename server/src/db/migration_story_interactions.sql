-- Migration: Story Views & Reactions
-- Ejecutar en Supabase SQL Editor

-- ─── STORY VIEWS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_views (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  viewer_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(story_id, viewer_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON story_views(story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_viewer_id ON story_views(viewer_id);

ALTER TABLE story_views ENABLE ROW LEVEL SECURITY;

-- Owner can see who viewed their stories
CREATE POLICY "owner_select_story_views" ON story_views
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM stories WHERE stories.id = story_id AND stories.user_id = auth.uid())
  );

-- Any authenticated user can insert their own view
CREATE POLICY "self_insert_story_views" ON story_views
  FOR INSERT WITH CHECK (
    viewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM stories WHERE stories.id = story_id AND stories.created_at >= NOW() - INTERVAL '24 hours'
    )
  );

-- ─── STORY REACTIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS story_reactions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  story_id UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_reactions_story_id ON story_reactions(story_id);
CREATE INDEX IF NOT EXISTS idx_story_reactions_user_id ON story_reactions(user_id);

ALTER TABLE story_reactions ENABLE ROW LEVEL SECURITY;

-- Owner can see reactions on their stories
CREATE POLICY "owner_select_story_reactions" ON story_reactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM stories WHERE stories.id = story_id AND stories.user_id = auth.uid())
  );

-- Users can insert/update/delete their own reactions
CREATE POLICY "self_insert_story_reactions" ON story_reactions
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM stories WHERE stories.id = story_id AND stories.created_at >= NOW() - INTERVAL '24 hours'
    )
  );

CREATE POLICY "self_update_story_reactions" ON story_reactions
  FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "self_delete_story_reactions" ON story_reactions
  FOR DELETE USING (user_id = auth.uid());
