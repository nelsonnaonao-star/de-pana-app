-- ============================================================================
-- FIX Fase 2 — SELECT de miembro + cierre de INSERT/DELETE no autorizado
-- ============================================================================
-- ESTADO: NO EJECUTADO. Requiere revisión y aplicación manual en Supabase
--         (Dashboard > SQL Editor) por el responsable del proyecto.
--
-- ORDEN DE DESPLIEGUE:
--   1) phase1_security.sql
--   2) fix_hide_profile_private_columns.sql
--   3) ESTE script (incluye el trigger de chats y la verificación fail-closed)
--
--   NO ejecutar después de este script:
--     - fix_rls.sql (obsoleto; reintroduce participants_insert_self y grants a anon)
--     - migration_rls_fix_v4.sql / migration_rls_policies.sql (históricos;
--       recrean chat_participants_insert_own_chat)
--
-- VULNERABILIDAD:
--   La política "participants_insert_self" permitía que cualquier usuario
--   autenticado insertara su propio profile_id en CUALQUIER chat. Al ser
--   miembro, user_in_chat()/is_chat_member() le concedía lectura de messages
--   y del chat: autoincorporación a conversaciones privadas ajenas.
--
--   Las políticas "chat_participants_insert_own_chat" / "participants_insert_own_chat"
--   permitían además que un miembro de un 1:1 añadiera a un tercero.
--
--   La política "chat_participants_delete_own_or_self" permitía que cualquier
--   miembro eliminara a otros participantes, aunque el servidor solo autoriza
--   al admin del grupo (/api/groups/remove-participant).
--
-- FLUJOS LEGÍTIMOS PRESERVADOS:
--   - Crear chats 1:1: /api/data/create-chat (service_role).
--   - Crear grupos: /api/data/create-group (service_role).
--   - Añadir/expulsar participantes: /api/groups/add-participants y
--     /api/groups/remove-participant (service_role), que en groups.js:298
--     exigen chats.admin_id === auth.uid().
--   - Fallback cliente addGroupMember (src/services/chats.ts:288-295): solo
--     funciona de forma legítima para el admin del grupo -> lo cubre
--     "participants_insert_admin".
--   - Salir de un grupo / rechazar invitación: DELETE propio
--     ("participants_delete_self").
--   - Expulsión por el admin del grupo desde el cliente: "participants_delete_admin".
--
-- RESULTADO: INSERT directo desde el cliente queda restringido al admin de un
--   grupo. DELETE queda restringido al propio usuario o al admin del grupo.
--   SELECT queda restringido a miembros del chat. El resto de operaciones
--   pasan por el servidor (service_role, sin RLS).
--
-- TRANSACCIONALIDAD Y FAIL-CLOSED:
--   La eliminación de TODAS las políticas de chat_participants se ejecuta
--   antes de BEGIN y se confirma con COMMIT explícito. Después, la creación de
--   las políticas seguras, el trigger y la verificación se ejecutan en una
--   sola transacción.
--   Si la verificación o cualquier DDL posterior falla, el rollback deja la
--   tabla SIN políticas (deniega SELECT/INSERT/DELETE al cliente), no con las
--   políticas peligrosas restauradas. Es un estado fail-closed: la app puede
--   fallar hasta corregir el problema, pero no queda expuesta.
--   Requiere que phase1_security.sql ya haya creado user_in_chat(); el script
--   no está pensado para ejecutarse sobre una base sin ese prerequisito.
-- ============================================================================

-- 0) LIMPIEZA DEFENSIVA PREVIA (se confirma antes de abrir la transacción).
--    Se eliminan TODAS las políticas de chat_participants, incluidas las
--    históricas de SELECT. La transacción siguiente recrea únicamente el
--    conjunto permitido. Si algo falla después, no hay políticas peligrosas
--    que un rollback pueda restaurar.
--
--    COMMIT explícito: si el editor envía todo el script como una única
--    transacción implícita, sin este COMMIT la limpieza quedaría dentro de la
--    transacción y un fallo posterior la revertiría, restaurando las políticas
--    peligrosas. Fuera de una transacción, COMMIT solo emite un aviso.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.polname
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'chat_participants'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.chat_participants', r.polname);
  END LOOP;
END $$;

COMMIT;

BEGIN;

-- 0) Garantizar RLS. La app cliente depende de estas políticas; el servidor
--    usa service_role y no se ve afectado.
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;

-- 1) SELECT: solo miembros del chat (recrea la política vigente de phase1).
DROP POLICY IF EXISTS "participants_select_member" ON public.chat_participants;
CREATE POLICY "participants_select_member" ON public.chat_participants
  FOR SELECT TO authenticated
  USING (public.user_in_chat(chat_id, auth.uid()));

-- 2) INSERT: eliminar autoincorporación y altas entre miembros.
DROP POLICY IF EXISTS "participants_insert_self" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_insert_own_chat" ON public.chat_participants;
DROP POLICY IF EXISTS "participants_insert_own_chat" ON public.chat_participants;

-- Única política de INSERT permitida: admin del grupo.
DROP POLICY IF EXISTS "participants_insert_admin" ON public.chat_participants;
CREATE POLICY "participants_insert_admin" ON public.chat_participants
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = chat_participants.chat_id
        AND chats.admin_id = auth.uid()
        AND chats.is_group = true
    )
  );

-- 3) DELETE: eliminar la política que permitía a un miembro expulsar a otros.
DROP POLICY IF EXISTS "chat_participants_delete_own_or_self" ON public.chat_participants;
DROP POLICY IF EXISTS "participants_delete_own_or_self" ON public.chat_participants;

-- Salir del grupo / rechazar invitación: solo la propia fila.
DROP POLICY IF EXISTS "participants_delete_self" ON public.chat_participants;
CREATE POLICY "participants_delete_self" ON public.chat_participants
  FOR DELETE TO authenticated
  USING (profile_id = auth.uid());

-- Expulsar a otro: solo el admin del grupo (o service_role, que bypassa RLS).
DROP POLICY IF EXISTS "participants_delete_admin" ON public.chat_participants;
CREATE POLICY "participants_delete_admin" ON public.chat_participants
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = chat_participants.chat_id
        AND chats.admin_id = auth.uid()
        AND chats.is_group = true
    )
  );

-- 4) Proteger campos sensibles de chats. Sin esto, un miembro podría cambiar
--    is_group (convertir un 1:1 en grupo) o admin_id (autoadjudicarse el chat)
--    y luego usar participants_insert_admin. Solo service_role puede cambiarlos.
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

-- 5) VERIFICACIÓN FAIL-CLOSED. Si algo no cumple, la excepción aborta la
--    transacción completa y no deja el fix a medias.
DO $$
DECLARE
  v_count integer;
  v_expr text;
  v_func text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.chat_participants'::regclass) THEN
    RAISE EXCEPTION 'chat_participants no tiene RLS habilitada';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class
          WHERE oid = 'public.chats'::regclass) THEN
    RAISE EXCEPTION 'chats no tiene RLS habilitada';
  END IF;

  -- El conjunto final debe ser exactamente 4 políticas: SELECT, INSERT, 2 DELETE.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants';

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Se esperaban 4 políticas en chat_participants, hay %', v_count;
  END IF;

  -- Debe existir exactamente una política SELECT y debe ser de miembro.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants' AND cmd = 'SELECT';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Se esperaba 1 política SELECT en chat_participants, hay %', v_count;
  END IF;

  SELECT qual INTO v_expr
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants'
    AND cmd = 'SELECT' AND policyname = 'participants_select_member'
    AND 'authenticated' = ANY(roles);

  IF v_expr IS NULL OR v_expr NOT LIKE '%user_in_chat%auth.uid()%' THEN
    RAISE EXCEPTION 'participants_select_member no exige miembro del chat: %', coalesce(v_expr, '<null>');
  END IF;

  -- Debe existir exactamente una política INSERT y debe ser la del admin.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants' AND cmd = 'INSERT';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Se esperaba 1 política INSERT en chat_participants, hay %', v_count;
  END IF;

  SELECT with_check INTO v_expr
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants'
    AND cmd = 'INSERT' AND policyname = 'participants_insert_admin'
    AND 'authenticated' = ANY(roles);

  IF v_expr IS NULL
     OR v_expr NOT LIKE '%admin_id%auth.uid()%'
     OR v_expr NOT LIKE '%is_group%true%' THEN
    RAISE EXCEPTION 'participants_insert_admin no exige admin del grupo: %', coalesce(v_expr, '<null>');
  END IF;

  -- Debe haber exactamente dos políticas DELETE: self y admin del grupo.
  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants' AND cmd = 'DELETE';

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Se esperaban 2 políticas DELETE en chat_participants, hay %', v_count;
  END IF;

  SELECT qual INTO v_expr
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants'
    AND cmd = 'DELETE' AND policyname = 'participants_delete_self'
    AND 'authenticated' = ANY(roles);

  IF v_expr IS NULL OR v_expr NOT LIKE '%profile_id%auth.uid()%' THEN
    RAISE EXCEPTION 'participants_delete_self no restringe a la propia fila: %', coalesce(v_expr, '<null>');
  END IF;

  SELECT qual INTO v_expr
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'chat_participants'
    AND cmd = 'DELETE' AND policyname = 'participants_delete_admin'
    AND 'authenticated' = ANY(roles);

  IF v_expr IS NULL
     OR v_expr NOT LIKE '%admin_id%auth.uid()%'
     OR v_expr NOT LIKE '%is_group%true%' THEN
    RAISE EXCEPTION 'participants_delete_admin no exige admin del grupo: %', coalesce(v_expr, '<null>');
  END IF;

  -- No deben sobrevivir políticas peligrosas conocidas (INSERT o DELETE).
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_participants'
      AND policyname IN (
        'participants_insert_self',
        'chat_participants_insert_own_chat',
        'participants_insert_own_chat',
        'chat_participants_delete_own_or_self',
        'participants_delete_own_or_self'
      )
  ) THEN
    RAISE EXCEPTION 'Quedaron políticas peligrosas en chat_participants';
  END IF;

  -- No debe existir ninguna vía UPDATE/ALL: el cliente no actualiza
  -- chat_participants, así que cualquier política de este tipo es inesperada.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_participants'
      AND cmd IN ('UPDATE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'chat_participants tiene políticas UPDATE/ALL inesperadas';
  END IF;

  -- Ninguna política puede alcanzar a anon ni a public.
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'chat_participants'
      AND roles && ARRAY['anon', 'public']::name[]
  ) THEN
    RAISE EXCEPTION 'chat_participants tiene políticas para anon/public';
  END IF;

  -- Trigger obligatorio y actualizado.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.chats'::regclass
      AND t.tgname = 'guard_sensitive_chat_fields'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND t.tgfoid = (
        SELECT p.oid
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'chats_guard_sensitive_fields'
      )
      AND pg_get_triggerdef(t.oid) LIKE '%BEFORE UPDATE%'
  ) THEN
    RAISE EXCEPTION 'Falta el trigger guard_sensitive_chat_fields en chats';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_func
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'chats_guard_sensitive_fields';

  IF v_func IS NULL
     OR v_func NOT LIKE '%NEW.admin_id%'
     OR v_func NOT LIKE '%NEW.profile_id%'
     OR v_func NOT LIKE '%NEW.is_group%' THEN
    RAISE EXCEPTION 'El trigger de chats no protege admin_id, profile_id e is_group';
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- DIAGNÓSTICO POST-FIX (solo lectura; no sustituye la verificación anterior)
-- ============================================================================
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'chat_participants'
ORDER BY cmd, policyname;

SELECT tgname, pg_get_triggerdef(oid) AS definicion
FROM pg_trigger
WHERE tgrelid = 'public.chats'::regclass AND NOT tgisinternal;

-- ============================================================================
-- ROLLBACK: NO restaurar "participants_insert_self",
-- "chat_participants_insert_own_chat" ni "chat_participants_delete_own_or_self".
-- Si la verificación falla, la transacción ya revierte todo. Corregir el flujo
-- de aplicación, nunca reabrir el INSERT/DELETE arbitrario.
-- ============================================================================
