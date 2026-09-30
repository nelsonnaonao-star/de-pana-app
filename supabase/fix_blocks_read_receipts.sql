-- ============================================================
-- FIX RED ON / DE PANA: Bloqueos reales + Doble check de lectura
-- Ejecutar en el SQL Editor de Supabase (igual que la limpieza).
-- 1) RLS de `blocks`: hoy está ACTIVADO pero SIN políticas, por eso
--    el cliente no puede ni bloquear, ni listar, ni desbloquear.
-- 2) RPC mark_messages_read: marca como leídos los mensajes de la
--    conversación desde el cliente (fallback si el server Node no
--    responde). La escritura dispara el evento UPDATE de Realtime,
--    con lo que el remitente ve el doble check azul.
-- ============================================================

-- ── 1) POLÍTICAS RLS PARA BLOQUEOS ─────────────────────────────
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_select_own" ON public.blocks;
CREATE POLICY "blocks_select_own"
  ON public.blocks FOR SELECT
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocks_insert_own" ON public.blocks;
CREATE POLICY "blocks_insert_own"
  ON public.blocks FOR INSERT
  WITH CHECK (blocker_id = auth.uid());

DROP POLICY IF EXISTS "blocks_delete_own" ON public.blocks;
CREATE POLICY "blocks_delete_own"
  ON public.blocks FOR DELETE
  USING (blocker_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.blocks TO authenticated;

-- ── 2) RPC: marcar mensajes como leídos (cliente -> BD directo) ─
-- CAMBIO (Fase 1, contador unread server-side): la función ahora escribe
-- `read_by` (estado de lectura POR USUARIO) en la MISMA sentencia UPDATE que
-- ya actualizaba status/read_at. Antes solo escribía status/read_at, lo que
-- dejaba 816 filas históricas con status='read' y read_by=[] y hacía imposible
-- saber quién había leído cada mensaje.
--
-- La condición que decide si una fila se modifica es la presencia del usuario
-- dentro del array `read_by` (jsonb), NO el valor de status/read_at. El guard
-- anterior `status IS DISTINCT FROM 'read' OR read_at IS NULL` queda
-- eliminado: con él, una fila ya marcada por la RPC quedaba congelada para
-- siempre y ningún usuario podía añadirse nunca a su read_by.
--
-- NO se consolidan status/read_at por grupo: enumerar los destinatarios reales
-- de un grupo es inseguro hoy (chat_participants incompleto). Pendiente de otra
-- fase, junto con la reparación de la membresía.
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_chat uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_is_member boolean;
  v_clear  timestamptz;
  v_now    timestamptz;
  v_now_iso jsonb;
  v_name   text;
  v_entry  jsonb;
  v_count  integer := 0;
BEGIN
  -- La identidad SIEMPRE viene de auth.uid(). Esta función no acepta ningún
  -- user_id ni nombre del cliente: un usuario normal no puede marcar como
  -- leído en nombre de otro.
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;

  -- Membresía: misma unión que get_user_chats / get_user_messages.
  SELECT EXISTS (
    SELECT 1
    FROM public.chats c
    WHERE c.id = p_chat
      AND c.deleted_at IS NULL
      AND (
        c.profile_id = v_user
        OR c.admin_id = v_user
        OR EXISTS (
          SELECT 1 FROM public.chat_participants cp
          WHERE cp.chat_id = p_chat AND cp.profile_id = v_user
        )
      )
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN 0;
  END IF;

  -- Respetar chat_clears ("borrar para mí"): no tocar anteriores al borrado.
  SELECT cleared_at INTO v_clear
  FROM public.chat_clears
  WHERE chat_id = p_chat AND user_id = v_user;

  v_now := now();
  -- readAt con el MISMO formato que ya escribe el endpoint Node
  -- (toISOString(): ISO-8601 con 'Z' y milisegundos). to_jsonb(now()) daría
  -- un offset horario distinto y rompería la forma real de la columna.
  v_now_iso := to_jsonb(to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));

  -- Nombre desde la BD, nunca desde el cliente.
  SELECT COALESCE(NULLIF(btrim(p.name), ''), 'Usuario')
    INTO v_name
  FROM public.profiles p
  WHERE p.id = v_user;
  v_name := COALESCE(v_name, 'Usuario');

  -- Entrada a anexar. userId va como texto en minúsculas canónicas, que es
  -- exactamente como está almacenado en los 2.211 elementos reales de read_by.
  v_entry := jsonb_build_object(
    'userId', v_user::text,
    'name',   v_name,
    'readAt', v_now_iso
  );

  -- Una SOLA sentencia UPDATE. La comprobación de "ya está en read_by" está en
  -- el WHERE (no solo en el SET) porque en READ COMMITTED PostgreSQL vuelve a
  -- evaluar el WHERE sobre la versión ya actualizada por una transacción
  -- concurrente: si el otro usuario se añadió primero, la fila deja de cumplir
  -- la condición y esta sentencia la omite en lugar de sobrescribirlo.
  -- El CASE del SET aplica la CASO A / CASO B explícitamente.
  UPDATE public.messages m
  SET read_by = CASE
        -- CASO A: el usuario ya está -> conservar el array tal cual, sin
        -- duplicar la entrada ni alterar su readAt.
        WHEN COALESCE(m.read_by, '[]'::jsonb)
             @> jsonb_build_array(jsonb_build_object('userId', v_user::text))
          THEN COALESCE(m.read_by, '[]'::jsonb)
        -- CASO B: no está -> anexar al final, conservando los lectores previos.
        ELSE COALESCE(m.read_by, '[]'::jsonb) || jsonb_build_array(v_entry)
      END,
      -- Semántica de status/read_at conservada sin cambios respecto a la
      -- versión anterior. El COALESCE en read_at preserva una marca previa en
      -- lugar de sobrescribirla (el guard antiguo también las preservaba al
      -- excluir esas filas).
      status  = 'read',
      read_at = COALESCE(m.read_at, v_now)
  WHERE m.chat_id = p_chat
    AND m.sender_id <> v_user          -- nunca el emisor como lector de sí mismo
    AND m.is_deleted = false
    AND (v_clear IS NULL OR m.created_at > v_clear)
    -- Solo filas CASO B: una fila que ya contiene al usuario no se modifica y
    -- por tanto no incrementa el contador devuelto.
    AND NOT (
      COALESCE(m.read_by, '[]'::jsonb)
      @> jsonb_build_array(jsonb_build_object('userId', v_user::text))
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;

-- ============================================================
-- DONE
-- ============================================================