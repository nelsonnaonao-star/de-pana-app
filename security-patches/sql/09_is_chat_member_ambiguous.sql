-- ============================================================
-- PARCHE 09 - Corregir "column reference chat_id is ambiguous"
-- en la RPC public.is_chat_member(uuid, uuid)
--
-- Causa:
--   La versión desplegada usa un parámetro llamado "chat_id" y en el
--   cuerpo hace:
--       WHERE cp.chat_id = chat_id
--   PostgreSQL no sabe si el segundo "chat_id" es la columna
--   chat_participants.chat_id o el parámetro de la función.
--   Error: 42702 column reference "chat_id" is ambiguous.
--
-- Solución:
--   Mantener los nombres de los parámetros (chat_id, user_id) para no
--   romper las llamadas RPC existentes, pero referenciar el argumento
--   como $1. Así desaparece la ambigüedad sin cambiar la firma.
--
-- Seguridad:
--   Se conserva SECURITY DEFINER + search_path = public.
--   Se sigue ignorando el user_id del cliente: la membresía se calcula
--   siempre con auth.uid(). El parámetro user_id queda solo por
--   compatibilidad de la API.
--
-- Idempotente: se puede re-ejecutar.
-- Aplicar en Supabase Dashboard > SQL Editor.
-- ============================================================

-- ANTES DE APLICAR: confirma que la función actual usa "chat_id".
-- Si devuelve {chat_uuid,user_id}, NO ejecutes este script tal cual:
-- avísame y preparamos la variante para ese nombre de parámetro.
--
--   SELECT p.oid::regprocedure, p.proargnames
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'is_chat_member';

-- También guarda la definición actual para poder revertir:
--
--   SELECT pg_get_functiondef('public.is_chat_member(uuid, uuid)'::regprocedure);

CREATE OR REPLACE FUNCTION public.is_chat_member(chat_id uuid, user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.chats c
    WHERE c.id = $1
      AND (c.profile_id = auth.uid() OR c.admin_id = auth.uid())
  )
  OR EXISTS (
    SELECT 1
    FROM public.chat_participants cp
    WHERE cp.chat_id = $1
      AND cp.profile_id = auth.uid()
  );
$$;

-- Solo usuarios autenticados (y service_role para tareas internas).
REVOKE EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_chat_member(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- VERIFICACIÓN
-- ------------------------------------------------------------

-- 1) Debe devolver la definición nueva y contener "$1" en el cuerpo.
--    SELECT pg_get_functiondef('public.is_chat_member(uuid, uuid)'::regprocedure);

-- 2) No debe lanzar 42702. Debe devolver false (auth.uid() es null
--    en el SQL Editor, salvo que se simule una sesión).
--    SELECT public.is_chat_member(
--      '00000000-0000-0000-0000-000000000000'::uuid,
--      '00000000-0000-0000-0000-000000000000'::uuid
--    );

-- 3) Prueba con un chat real y un usuario miembro (opcional).
--    El ROLLBACK no modifica nada.
--
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT set_config('request.jwt.claim.sub', '<USER_ID>', true);
--    SELECT set_config(
--      'request.jwt.claims',
--      json_build_object('sub', '<USER_ID>', 'role', 'authenticated')::text,
--      true
--    );
--    SELECT public.is_chat_member('<CHAT_ID>'::uuid, '<USER_ID>'::uuid);
--    ROLLBACK;

-- ------------------------------------------------------------
-- ROLLBACK
-- ------------------------------------------------------------
-- No hagas DROP FUNCTION: varias políticas RLS dependen de ella.
-- Para revertir, restaura la definición que guardaste antes de aplicar:
--
--   CREATE OR REPLACE FUNCTION public.is_chat_member(chat_id uuid, user_id uuid)
--   ... (texto devuelto por pg_get_functiondef antes del cambio) ...
