-- ============================================================
-- HISTÓRICO — solo bucket público chat-images
-- Run this SQL in your Supabase Dashboard > SQL Editor
-- Grants INSERT and SELECT on the chat-images bucket to authenticated users
--
-- ADVERTENCIAS:
--   * Aplica únicamente a `chat-images` (bucket público). NO usar para
--     `chat-media`, que es privado y se sirve vía service_role/signed URLs.
--   * Las políticas son amplias: cualquier usuario authenticated puede subir
--     y leer cualquier objeto de `chat-images`; DELETE solo permite sus propios
--     objetos. No es un control de autorización por chat.
--   * No es idempotente: CREATE POLICY falla si la política ya existe.
--     Si se reaplica, eliminar antes con DROP POLICY IF EXISTS.
-- ============================================================

-- Allow authenticated users to upload files
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'chat-images');

-- Allow authenticated users to view/download files
CREATE POLICY "Allow authenticated downloads"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'chat-images');

-- Allow users to delete their own uploaded files
CREATE POLICY "Allow users to delete own files"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'chat-images' AND owner_id = auth.uid());
