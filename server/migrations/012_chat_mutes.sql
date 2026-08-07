-- MUTE DE GRUPO COMPLETO (SILENCIAR TODO EL GRUPO)
-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Permite silenciar TODO un grupo (no por participante) durante 8h/12h/24h o "Siempre".
--   chat_mutes.chat_id     = el grupo silenciado (una sola fila por grupo)
--   chat_mutes.muted_until = timestamp límite; NULL significa "Siempre" mientras active=true
--   chat_mutes.active      = si la fila está en vigor o fue desactivada
--   chat_mutes.muted_by    = quién aplicó el silencio
-- Para reactivar el sonido basta con (active=false) o borrar la fila.

CREATE TABLE IF NOT EXISTS chat_mutes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id   uuid NOT NULL,
  muted_until timestamptz,
  active    boolean NOT NULL DEFAULT true,
  muted_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_mutes_chat ON chat_mutes(chat_id);

-- RLS: cualquier miembro del grupo puede consultar el estado del silencio,
-- y también puede silenciar/desactivar (la acción aplica a todo el grupo).
ALTER TABLE chat_mutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_mutes_select_member" ON chat_mutes;
CREATE POLICY "chat_mutes_select_member"
  ON chat_mutes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_insert_member" ON chat_mutes;
CREATE POLICY "chat_mutes_insert_member"
  ON chat_mutes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_update_member" ON chat_mutes;
CREATE POLICY "chat_mutes_update_member"
  ON chat_mutes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_delete_member" ON chat_mutes;
CREATE POLICY "chat_mutes_delete_member"
  ON chat_mutes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );