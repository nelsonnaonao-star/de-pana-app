-- ============================================================
-- WEPA SECURITY HARDENING v1
-- Fecha: 2026-08-30
-- 
-- Este archivo contiene:
--   BLOQUE 1: Triggers para proteger campos sensibles en messages
--   BLOQUE 2: Triggers para proteger campos sensibles en calls
--   BLOQUE 3: Consolidación de funciones RPC (user_in_chat, is_chat_member)
--
-- INSTRUCCIONES:
--   Ejecutar este archivo UNA SOLA VEZ en el Dashboard de Supabase
--   (SQL Editor). No requiere reiniciar la app.
--
-- NO ELIMINA migraciones anteriores. Solo agrega triggers y
-- redefine funciones de forma segura.
-- ============================================================


-- ============================================================
-- BLOQUE 1: TRIGGER messages_guard_sensitive_fields
-- 
-- QUÉ PROTEGE: Impide que un usuario autenticado (no service_role)
--   modifique campos que no debería poder cambiar en mensajes ajenos.
--
-- CAMPOS BLOQUEADOS PARA CAMBIO:
--   sender_id, chat_id, is_deleted, text, has_image, has_audio,
--   has_video, has_document, has_location, is_animated, created_at
--
-- CAMPOS PERMITIDOS PARA CAMBIO:
--   status, read_at, poll_options, edited, sticker_url, gif_url,
--   reply_to_id, reply_to_text, reply_to_sender, image_url,
--   audio_url, video_url, file_url, document_name, document_size,
--   document_type, mime_type, audio_duration, latitude, longitude,
--   location_name, is_ephemeral, ephemeral_timer, ephemeral_expires_at,
--   poll_question, poll_options, forwarded, image_alt
--
-- QUÉ PODRÍA ROMPER: Nada si los campos permitidos son correctos.
-- POR QUÉ NO LO ROMPERÁ: Solo bloquea cambios a campos que el cliente
--   legítimo nunca debería modificar directamente.
-- CÓMO LO VAMOS A PROBAR: Enviar mensaje, marcar leído, eliminar
--   para todos, editar mensaje, votar encuesta — todo debe seguir
--   funcionando.
-- ============================================================

-- Primero eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS guard_sensitive_fields ON messages;

-- Crear función del trigger
CREATE OR REPLACE FUNCTION public.messages_guard_sensitive_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- service_role bypass (server-side code)
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Bloquear cambio de sender_id (impide suplantación de identidad)
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'No se puede modificar el remitente del mensaje';
  END IF;

  -- Bloquear cambio de chat_id (impide mover mensajes entre chats)
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
    RAISE EXCEPTION 'No se puede mover el mensaje a otro chat';
  END IF;

  -- Bloquear cambio de is_deleted (impide eliminación no autorizada)
  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted THEN
    RAISE EXCEPTION 'No se puede modificar el estado de eliminación desde el cliente';
  END IF;

  -- Bloquear cambio de text (la edición se maneja por endpoint server)
  IF NEW.text IS DISTINCT FROM OLD.text THEN
    RAISE EXCEPTION 'No se puede modificar el texto directamente';
  END IF;

  -- Bloquear cambio de created_at
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'No se puede modificar la fecha de creación';
  END IF;

  -- Bloquear cambio de campos de media (has_image, has_audio, etc.)
  IF NEW.has_image IS DISTINCT FROM OLD.has_image
     OR NEW.has_audio IS DISTINCT FROM OLD.has_audio
     OR NEW.has_video IS DISTINCT FROM OLD.has_video
     OR NEW.has_document IS DISTINCT FROM OLD.has_document
     OR NEW.has_location IS DISTINCT FROM OLD.has_location
     OR NEW.is_animated IS DISTINCT FROM OLD.is_animated THEN
    RAISE EXCEPTION 'No se puede modificar el tipo de media del mensaje';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Adjuntar trigger a la tabla messages
CREATE TRIGGER guard_sensitive_fields
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_guard_sensitive_fields();


-- ============================================================
-- BLOQUE 2: TRIGGER calls_guard_sensitive_fields
--
-- QUÉ PROTEGE: Impide que participantes modifiquen campos
--   identitarios de llamadas.
--
-- CAMPOS BLOQUEADOS PARA CAMBIO:
--   caller_id, callee_id, room_id
--
-- CAMPOS PERMITIDOS PARA CAMBIO:
--   status, started_at, ended_at, duration, rating, type, call_type,
--   chat_id
--
-- QUÉ PODRÍA ROMPER: Nada. Los campos permitidos cubren todos los
--   flujos legítimos de llamadas 1:1.
-- POR QUÉ NO LO ROMPERÁ: Solo bloquea cambios que ningún flujo
--   legítimo necesita hacer.
-- CÓMO LO VAMOS A PROBAR: Iniciar llamada, contestar, cerrar,
--   calificar — todo debe seguir funcionando.
-- ============================================================

DROP TRIGGER IF EXISTS guard_sensitive_fields ON calls;

CREATE OR REPLACE FUNCTION public.calls_guard_sensitive_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- service_role bypass
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Bloquear cambio de caller_id
  IF NEW.caller_id IS DISTINCT FROM OLD.caller_id THEN
    RAISE EXCEPTION 'No se puede modificar el emisor de la llamada';
  END IF;

  -- Bloquear cambio de callee_id
  IF NEW.callee_id IS DISTINCT FROM OLD.callee_id THEN
    RAISE EXCEPTION 'No se puede modificar el receptor de la llamada';
  END IF;

  -- Bloquear cambio de room_id
  IF NEW.room_id IS DISTINCT FROM OLD.room_id THEN
    RAISE EXCEPTION 'No se puede modificar el room ID de la llamada';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

CREATE TRIGGER guard_sensitive_fields
  BEFORE UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION public.calls_guard_sensitive_fields();


-- ============================================================
-- BLOQUE 3: Consolidación de funciones RPC
--
-- QUÉ PROTEGE: Asegura que user_in_chat() e is_chat_member()
--   SIEMPRE usen auth.uid() y nunca confíen en parámetros del cliente.
--
-- QUÉ PODRÍA ROMPER: Nada. Las funciones nuevas son compatibles
--   con las interfaces existentes (misma firma).
-- POR QUÉ NO LO ROMPERÁ: Solo cambiamos el internal logic para
--   ignorar el parámetro user_id y usar auth.uid() directamente.
-- CÓMO LO VAMOS A PROBAR: Verificar que el chat sigue cargando
--   mensajes y que las políticas RLS siguen funcionando.
-- ============================================================

-- user_in_chat: SIEMPRE usa auth.uid(), ignora el parámetro user_uuid
CREATE OR REPLACE FUNCTION public.user_in_chat(chat_uuid uuid, user_uuid uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_uuid
      AND (
        c.profile_id = auth.uid()
        OR c.admin_id = auth.uid()
      )
  ) OR EXISTS (
    SELECT 1 FROM chat_participants cp
    WHERE cp.chat_id = chat_uuid
      AND cp.profile_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- is_chat_member: SIEMPRE usa auth.uid(), ignora el parámetro user_id
CREATE OR REPLACE FUNCTION public.is_chat_member(chat_uuid uuid, user_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_uuid
      AND (
        c.profile_id = auth.uid()
        OR c.admin_id = auth.uid()
      )
  ) OR EXISTS (
    SELECT 1 FROM chat_participants cp
    WHERE cp.chat_id = chat_uuid
      AND cp.profile_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public;

-- Asegurar grants correctos (solo authenticated, NO anon)
REVOKE EXECUTE ON FUNCTION public.user_in_chat(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_in_chat(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) TO authenticated;


-- ============================================================
-- VERIFICACIÓN
-- Ejecutar queries de verificación después de la migración:
--
-- SELECT trigger_name, event_manipulation, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name = 'guard_sensitive_fields';
--
-- SELECT routine_name, security_type, routine_definition
-- FROM information_schema.routines
-- WHERE routine_name IN ('user_in_chat', 'is_chat_member');
--
-- SELECT grantee, privilege_type
-- FROM information_schema.role_routines
-- WHERE routine_name IN ('user_in_chat', 'is_chat_member');
-- ============================================================
