-- ============================================================
-- PARCHE 07 (versión segura) - Cerrar SOLO el SELECT de chat-images
--
-- ESTADO: APLICADO 2026-11-09 (solo SELECT). El INSERT se conserva.
--
-- Qué hace:
--   Elimina únicamente "Allow authenticated downloads" (SELECT).
--   Con eso se cierra el listado/lectura vía API de todo el bucket.
--
-- Qué NO hace:
--   - NO elimina INSERT: src/services/storage.ts sigue subiendo avatares,
--     flyers, avatares de grupo y stickers directamente a chat-images
--     con supabase.storage.from('chat-images').upload(...). Si se quita
--     INSERT, esas subidas se rompen.
--   - NO hace privadas las fotos viejas: siguen accesibles por URL pública
--     (bucket public = true).
--
-- Cierre total (para más adelante):
--   1. Mover uploadChatMedia/uploadAvatar a un endpoint del servidor con
--      service_role (o a un bucket privado).
--   2. Verificar que ningún cliente sube directo a chat-images.
--   3. Recién entonces eliminar también "Allow authenticated uploads".
-- ============================================================

DROP POLICY IF EXISTS "Allow authenticated downloads" ON storage.objects;

-- Se conservan a propósito:
--   "Allow authenticated uploads"    -> INSERT para avatares/flyers/stickers
--   "Allow users to delete own files" -> DELETE de archivos propios

-- Verificación esperada:
--   - "Allow authenticated downloads" ya no existe.
--   - "Allow authenticated uploads" sigue existiendo.
--
-- SELECT policyname, cmd
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname IN (
--     'Allow authenticated uploads',
--     'Allow authenticated downloads',
--     'Allow users to delete own files'
--   )
-- ORDER BY policyname;

-- ============================================================
-- FUTURO (NO EJECUTAR AÚN): cierre total del bucket.
-- Requiere haber migrado uploadChatMedia al servidor.
-- ============================================================
-- DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
-- DROP POLICY IF EXISTS "Allow users to delete own files" ON storage.objects;
