-- ============================================================
-- PARCHE 03 - Silencio por usuario (chat_id, user_id)
-- Aplicar en Supabase Dashboard > SQL Editor.
--
-- Situación actual (server/migrations/012_chat_mutes.sql):
--   UNIQUE (chat_id)  -> una sola fila por chat; el mute es GLOBAL.
--   /api/groups/unmute no comprueba pertenencia -> cualquiera puede
--   desilenciar cualquier chat para todos.
--
-- Este parche cambia el modelo a una fila por (chat_id, user_id) y
-- refuerza las políticas RLS para que cada usuario solo gestione su
-- propia preferencia. Las filas antiguas sin muted_by se eliminan
-- porque no se puede atribuir su autor.
--
-- Hacer backup de chat_mutes antes de ejecutar.
-- ============================================================

BEGIN;

ALTER TABLE public.chat_mutes
  ADD COLUMN IF NOT EXISTS user_id uuid;

-- Backfill: el autor conocido del mute pasa a ser el dueño de la fila.
UPDATE public.chat_mutes
   SET user_id = muted_by
 WHERE user_id IS NULL
   AND muted_by IS NOT NULL;

-- Filas globales sin autor: no se pueden atribuir a nadie.
DELETE FROM public.chat_mutes
 WHERE user_id IS NULL;

ALTER TABLE public.chat_mutes
  ALTER COLUMN user_id SET NOT NULL;

-- Quitar la unicidad por chat y crear la unicidad por usuario/chat.
ALTER TABLE public.chat_mutes
  DROP CONSTRAINT IF EXISTS chat_mutes_chat_id_key;

ALTER TABLE public.chat_mutes
  DROP CONSTRAINT IF EXISTS chat_mutes_chat_user_key;

ALTER TABLE public.chat_mutes
  ADD CONSTRAINT chat_mutes_chat_user_key UNIQUE (chat_id, user_id);

CREATE INDEX IF NOT EXISTS idx_chat_mutes_chat_user
  ON public.chat_mutes(chat_id, user_id);

-- ------------------------------------------------------------
-- RLS: cada usuario solo ve y modifica su propia fila.
-- El servidor usa service_role y no se ve afectado.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chat_mutes_select_member" ON public.chat_mutes;
CREATE POLICY "chat_mutes_select_member"
  ON public.chat_mutes FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_insert_member" ON public.chat_mutes;
CREATE POLICY "chat_mutes_insert_member"
  ON public.chat_mutes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_update_member" ON public.chat_mutes;
CREATE POLICY "chat_mutes_update_member"
  ON public.chat_mutes FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "chat_mutes_delete_member" ON public.chat_mutes;
CREATE POLICY "chat_mutes_delete_member"
  ON public.chat_mutes FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants
      WHERE chat_participants.chat_id = chat_mutes.chat_id
        AND chat_participants.profile_id = auth.uid()
    )
  );

COMMIT;

-- Verificación:
-- SELECT chat_id, user_id, active, muted_until, muted_by
-- FROM public.chat_mutes ORDER BY chat_id, user_id;
--
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conrelid = 'public.chat_mutes'::regclass;
