-- ============================================================
-- PHASE 1 — HARDENING DE SEGURIDAD (v1.0)
-- Aplicar UNA vez en: Supabase Dashboard → SQL Editor → Run.
-- Idempotente solo ANTES de aplicar fix_participants_insert_self_v1.sql.
-- NO re-ejecutar después de la Fase 2: elimina todas las políticas de
-- chat_participants y las recrea, pudiendo borrar ajustes posteriores.
-- El orden correcto es aplicar la Fase 2 una sola vez y no volver atrás.
-- Alcance: perfiles, chats, chat_participants, messages, app_errors.
--
-- ORDEN DE DESPLIEGUE LIMPIO:
--   1) Este script.
--   2) supabase/fix_hide_profile_private_columns.sql (protege real_email/pin).
--   3) supabase/fix_participants_insert_self_v1.sql (SELECT/INSERT/DELETE de
--      participantes + trigger de campos sensibles de chats).
-- No ejecutar después: fix_rls.sql, migration_rls_fix_v4.sql ni
-- migration_rls_policies.sql (históricos; reintroducen políticas inseguras).
-- Tampoco re-ejecutar este phase1_security.sql después de la Fase 2.
-- ============================================================

-- ============================================================
-- 0) GARANTIZAR QUE RLS ESTÁ HABILITADA EN LAS TABLAS CRÍTICAS
-- ============================================================
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_errors        ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 1) ELIMINAR TODAS LAS POLÍTICAS EXISTENTES (todas las generaciones)
-- ============================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, p.polname AS pol
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('profiles', 'chats', 'chat_participants', 'messages', 'app_errors')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.pol, r.tbl);
  END LOOP;
END $$;

-- ============================================================
-- 2) FUNCIONES SECURITY DEFINER ENDURECIDAS
--    Ya NO confían en el user_uuid que manda el cliente:
--    usan auth.uid() INTERNO. Revocan acceso a anon.
-- ============================================================

-- user_in_chat: ignora el 2º parámetro y valida contra el usuario autenticado
CREATE OR REPLACE FUNCTION user_in_chat(chat_uuid uuid, user_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_uuid
    AND c.deleted_at IS NULL
    AND (
      c.profile_id = auth.uid()
      OR c.admin_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.chat_participants cp
        WHERE cp.chat_id = c.id AND cp.profile_id = auth.uid()
      )
    )
  );
$$;

-- is_chat_member: igual, sin confiar en el user_id del cliente
CREATE OR REPLACE FUNCTION is_chat_member(chat_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_id
      AND (c.profile_id = auth.uid() OR c.admin_id = auth.uid())
  ) OR EXISTS (
    SELECT 1 FROM public.chat_participants cp
    WHERE cp.chat_id = chat_id
      AND cp.profile_id = auth.uid()
  );
$$;

-- get_user_chats: ignora el user_uuid del cliente
CREATE OR REPLACE FUNCTION get_user_chats(user_uuid uuid)
RETURNS SETOF chats
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.* FROM public.chats c
  WHERE c.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_clears cc
    WHERE cc.chat_id = c.id
      AND cc.user_id = auth.uid()
      AND cc.hidden = true
  )
  AND (
    c.profile_id = auth.uid()
    OR c.admin_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chat_participants cp
      WHERE cp.chat_id = c.id AND cp.profile_id = auth.uid()
    )
  )
  ORDER BY c.updated_at DESC;
$$;

-- get_user_messages: elimina TODOS los overloads previos y crea la firma
-- EXACTA que usa el cliente (chat_uuid, user_uuid, p_limit, p_before, p_after)
-- con paginación real, validando contra auth.uid().
-- Paginación profesional por llave (keyset): la ventana inicial devuelve los
-- p_limit MÁS RECIENTES (DESC+limit, re-ordenados ASC), y los cursores
-- before/after recorren la historia hacia arriba o hacen catch-up tras una
-- reconexión. Esto evita que los mensajes nuevos queden invisibles en chats
-- con más de p_limit mensajes (bug previo: ASC LIMIT devolvía los más antiguos).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT oid::regprocedure AS sig
    FROM pg_proc
    WHERE proname = 'get_user_messages'
      AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION get_user_messages(
  chat_uuid uuid,
  user_uuid uuid,
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL,
  p_after  timestamptz DEFAULT NULL
)
RETURNS SETOF messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM (
    SELECT m.* FROM public.messages m
    WHERE m.chat_id = chat_uuid
    AND (m.is_deleted = false OR m.is_deleted IS NULL)
    AND (
      m.is_ephemeral IS NOT TRUE
      OR m.ephemeral_expires_at IS NULL
      OR m.ephemeral_expires_at > now()
    )
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id = chat_uuid
      AND c.deleted_at IS NULL
      AND (
        c.profile_id = auth.uid()
        OR c.admin_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.chat_participants cp
          WHERE cp.chat_id = c.id AND cp.profile_id = auth.uid()
        )
      )
    )
    AND (p_after  IS NULL OR m.created_at > p_after)
    AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT p_limit
  ) t
  ORDER BY t.created_at ASC, t.id ASC;
$$;

-- ============================================================
-- 3) GRANT: solo authenticated, NADA para anon
-- ============================================================
REVOKE EXECUTE ON FUNCTION user_in_chat(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION is_chat_member(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_user_chats(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) FROM anon, public;

GRANT EXECUTE ON FUNCTION user_in_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION is_chat_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) TO authenticated;

-- ============================================================
-- 4) POLÍTICAS FINALES
-- ============================================================

-- ── PROFILES ─────────────────────────────────────────────
-- SOLO autenticados leen perfiles por fila (búsqueda/contactos).
-- IMPORTANTE: RLS filtra filas, no columnas. La protección de real_email y
-- pin se establece en supabase/fix_hide_profile_private_columns.sql
-- (REVOKE SELECT de tabla + GRANT de columnas públicas). Este script NO
-- concede SELECT de tabla sobre profiles; un despliegue limpio debe aplicar
-- fix_hide después de este archivo. Los grants reales deben verificarse en
-- el proyecto Supabase (no se asumen activos aquí).
CREATE POLICY "profiles_select_auth" ON profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ── CHATS ────────────────────────────────────────────────
CREATE POLICY "chats_select_member" ON chats
  FOR SELECT TO authenticated USING (user_in_chat(id, auth.uid()));

CREATE POLICY "chats_insert_1to1" ON chats
  FOR INSERT TO authenticated WITH CHECK (
    (profile_id = auth.uid() OR admin_id = auth.uid())
    AND is_group = false
  );

CREATE POLICY "chats_insert_group" ON chats
  FOR INSERT TO authenticated WITH CHECK (admin_id = auth.uid() AND is_group = true);

CREATE POLICY "chats_update_member" ON chats
  FOR UPDATE TO authenticated
  USING (user_in_chat(id, auth.uid()))
  WITH CHECK (user_in_chat(id, auth.uid()));

CREATE POLICY "chats_delete_admin" ON chats
  FOR DELETE TO authenticated USING (admin_id = auth.uid());

-- ── CHAT_PARTICIPANTS ────────────────────────────────────
-- SELECT: cualquier miembro del chat puede ver la lista (lo usa
-- GroupInfoPanel: src/hooks/chat/useGroupManagement.ts:41-44).
CREATE POLICY "participants_select_member" ON chat_participants
  FOR SELECT TO authenticated USING (user_in_chat(chat_id, auth.uid()));

-- NOTA: se eliminó "participants_insert_self" (profile_id = auth.uid()),
-- que permitía a cualquier autenticado autoincorporarse a un chat ajeno.
-- El INSERT directo desde el cliente queda restringido al admin del grupo;
-- el resto de altas pasan por el servidor (service_role). Ver
-- supabase/fix_participants_insert_self_v1.sql.
CREATE POLICY "participants_insert_admin" ON chat_participants
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
      AND chats.admin_id = auth.uid()
      AND chats.is_group = true
    )
  );

CREATE POLICY "participants_delete_self" ON chat_participants
  FOR DELETE TO authenticated USING (profile_id = auth.uid());

CREATE POLICY "participants_delete_admin" ON chat_participants
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM chats
      WHERE chats.id = chat_participants.chat_id
      AND chats.admin_id = auth.uid()
      AND chats.is_group = true
    )
  );

-- ── MESSAGES ─────────────────────────────────────────────
CREATE POLICY "messages_select_member" ON messages
  FOR SELECT TO authenticated USING (user_in_chat(chat_id, auth.uid()));

CREATE POLICY "messages_insert_member" ON messages
  FOR INSERT TO authenticated WITH CHECK (
    sender_id = auth.uid()
    AND user_in_chat(chat_id, auth.uid())
  );

-- El cliente NUNCA hace UPDATE directo de mensajes (todo pasa por el
-- servidor con service_role). sender_id = auth.uid() es suficiente.
CREATE POLICY "messages_update_own" ON messages
  FOR UPDATE TO authenticated USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

CREATE POLICY "messages_delete_own" ON messages
  FOR DELETE TO authenticated USING (sender_id = auth.uid());

-- ── APP_ERRORS ───────────────────────────────────────────
CREATE POLICY "errors_insert_own" ON app_errors
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "errors_select_own" ON app_errors
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- 5) TRIGGER: proteger columnas sensibles de messages
--    (solo service_role puede cambiar sender_id, chat_id,
--     texto o is_deleted desde un UPDATE directo)
-- ============================================================
CREATE OR REPLACE FUNCTION messages_guard_sensitive_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id THEN
    RAISE EXCEPTION 'Cannot modify sender_id';
  END IF;
  IF NEW.chat_id IS DISTINCT FROM OLD.chat_id THEN
    RAISE EXCEPTION 'Cannot modify chat_id';
  END IF;

  IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
    RAISE EXCEPTION 'Cannot soft-delete messages directly';
  END IF;
  IF NEW.text IS DISTINCT FROM OLD.text AND OLD.text IS NOT NULL AND NEW.text IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot edit messages directly';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_sensitive_message_fields ON messages;

CREATE TRIGGER guard_sensitive_message_fields
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_guard_sensitive_fields();

-- ============================================================
-- VERIFICACIÓN (opcional): debe listar las 4 funciones y
-- NO debe aparecer 'anon' en ningún GRANT.
-- SELECT proname, proargtypes::regtype[] FROM pg_proc
--   WHERE proname IN ('get_user_chats','get_user_messages','user_in_chat','is_chat_member');
-- SELECT polname, polroles::regrole[] FROM pg_policy WHERE polrelid = 'profiles'::regclass;
-- ============================================================
