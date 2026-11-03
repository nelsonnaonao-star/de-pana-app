-- ============================================================
-- PARCHE 02 - Proteger admin_id, profile_id e is_group en chats
-- Aplicar en Supabase Dashboard > SQL Editor.
-- Idempotente: se puede re-ejecutar.
--
-- Sin este trigger, la política RLS "chats_update_member"
-- (supabase/phase1_security.sql:235) permite que CUALQUIER miembro
-- del chat actualice CUALQUIER columna de chats, incluido admin_id.
-- Resultado: autoascenso a administrador y toma del grupo.
-- ============================================================

CREATE OR REPLACE FUNCTION public.chats_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.admin_id IS DISTINCT FROM OLD.admin_id THEN
    RAISE EXCEPTION 'No se puede modificar el administrador del chat';
  END IF;

  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    RAISE EXCEPTION 'No se puede modificar el propietario del chat';
  END IF;

  IF NEW.is_group IS DISTINCT FROM OLD.is_group THEN
    RAISE EXCEPTION 'No se puede modificar el tipo de chat';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sensitive_chat_fields ON public.chats;

CREATE TRIGGER guard_sensitive_chat_fields
  BEFORE UPDATE ON public.chats
  FOR EACH ROW
  EXECUTE FUNCTION public.chats_guard_sensitive_fields();

-- Verificación: debe devolver 1 fila.
-- SELECT tgname FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- WHERE c.relname = 'chats' AND t.tgname = 'guard_sensitive_chat_fields';
