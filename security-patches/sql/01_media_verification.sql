-- ============================================================
-- PARCHE 01 - Verificación previa y posterior de media de chats
-- Solo lectura. Ejecutar antes y después de la migración.
-- ============================================================

-- 1) ¿Cuántos mensajes referencian cada bucket?
SELECT
  CASE
    WHEN attachment_url LIKE '%/chat-images/%' THEN 'chat-images (público)'
    WHEN attachment_url LIKE '%/chat-media/%'  THEN 'chat-media (privado)'
    WHEN attachment_url LIKE '%/chat-files/%'  THEN 'chat-files (privado)'
    WHEN attachment_url LIKE '%/voice-notes/%' THEN 'voice-notes (privado)'
    ELSE 'otro'
  END AS bucket_ref,
  count(*) AS mensajes
FROM public.messages
WHERE attachment_url IS NOT NULL
GROUP BY 1
ORDER BY mensajes DESC;

-- 2) Mensajes con media en el bucket público que hay que migrar.
--    (No imprimir URLs completas en tickets/logs.)
SELECT id, chat_id, type, created_at
FROM public.messages
WHERE attachment_url LIKE '%/chat-images/%'
ORDER BY created_at DESC
LIMIT 50;

-- 3) Estado de los buckets.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id IN ('chat-images', 'chat-media', 'chat-files', 'voice-notes')
ORDER BY id;

-- 4) Políticas actuales de storage.objects (revisar las de chat-images).
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
ORDER BY policyname;

-- 5) Comprobación de que el trigger de chats existe (punto 02).
SELECT t.tgname, p.proname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE c.relname = 'chats'
  AND t.tgname = 'guard_sensitive_chat_fields';
