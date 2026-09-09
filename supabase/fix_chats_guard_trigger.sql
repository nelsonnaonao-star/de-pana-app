-- ============================================================
-- SECURITY FIX: proteger admin_id y profile_id en chats
-- Run in: Supabase Dashboard → SQL Editor → New Query → Run
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sensitive_chat_fields ON public.chats;

CREATE TRIGGER guard_sensitive_chat_fields
  BEFORE UPDATE ON public.chats
  FOR EACH ROW
  EXECUTE FUNCTION public.chats_guard_sensitive_fields();
