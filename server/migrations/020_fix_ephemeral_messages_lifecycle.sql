-- 020 · Ciclo de vida de mensajes temporales
--
-- YA APLICADA Y VERIFICADA REMOTAMENTE. NO REAPLICAR.
-- Conservada en el repositorio como registro de la migración aplicada.
--
-- Objetivo:
--   1) get_user_messages no devuelve mensajes temporales expirados.
--   2) purge_expired_ephemeral_messages elimina únicamente temporales vencidos.
--
-- Conserva autorización, pertenencia, borrado lógico, cleared_at, paginación y orden.

BEGIN;

DO $$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_get_userbyid(p.proowner)
    INTO v_owner
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.purge_expired_ephemeral_messages()');

  v_owner := COALESCE(v_owner, current_user);

  IF NOT has_schema_privilege(v_owner, 'public', 'USAGE')
     OR NOT has_table_privilege(v_owner, 'public.messages', 'SELECT')
     OR NOT has_table_privilege(v_owner, 'public.messages', 'DELETE') THEN
    RAISE EXCEPTION 'El propietario % de public.purge_expired_ephemeral_messages no tiene USAGE en public o SELECT/DELETE en public.messages', v_owner
      USING HINT = 'Revisa owner_capabilities en supabase/preflight_020_ephemeral_messages.sql. La migración no cambia propietarios ni concede privilegios.';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_ephemeral_expires
  ON public.messages (ephemeral_expires_at)
  WHERE ephemeral_expires_at IS NOT NULL;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) AS sig
    FROM pg_proc p
    WHERE p.proname = 'get_user_messages'
      AND p.pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_user_messages(
  chat_uuid uuid,
  user_uuid uuid,
  p_limit integer DEFAULT 200,
  p_before timestamptz DEFAULT NULL,
  p_after  timestamptz DEFAULT NULL
)
RETURNS SETOF public.messages
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
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
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_clears cc
      WHERE cc.chat_id = m.chat_id
        AND cc.user_id = auth.uid()
        AND cc.cleared_at IS NOT NULL
        AND m.created_at <= cc.cleared_at
    )
    AND (p_after  IS NULL OR m.created_at > p_after)
    AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 200), 0), 200)
  ) t
  ORDER BY t.created_at ASC, t.id ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_messages(uuid, uuid, integer, timestamptz, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_expired_ephemeral_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.messages
  WHERE is_ephemeral IS TRUE
    AND ephemeral_expires_at IS NOT NULL
    AND ephemeral_expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- CREATE OR REPLACE conserva ACL previos: revocar también roles explícitos.
-- No se nombran roles personalizados porque no existen en el repositorio;
-- si la inspección remota los encuentra, deben revocarse expresamente.
REVOKE EXECUTE ON FUNCTION public.purge_expired_ephemeral_messages()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_ephemeral_messages() TO service_role;

COMMIT;
