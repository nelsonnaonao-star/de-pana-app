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
CREATE OR REPLACE FUNCTION public.mark_messages_read(p_chat uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_is_member boolean;
  v_clear timestamptz;
  v_count integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RETURN 0;
  END IF;

  -- Solo miembros del chat (mismas reglas que get_user_messages).
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

  -- Respetar chat_clears ("borrar para mí"): no marcar anteriores al borrado.
  SELECT cleared_at INTO v_clear
  FROM public.chat_clears
  WHERE chat_id = p_chat AND user_id = v_user;

  UPDATE public.messages m
  SET status = 'read',
      read_at = NOW()
  WHERE m.chat_id = p_chat
    AND m.sender_id <> v_user
    AND m.is_deleted = false
    AND (v_clear IS NULL OR m.created_at > v_clear)
    -- No re-marcar los ya leídos (evita ruido de UPDATEs en Realtime).
    AND (m.status IS DISTINCT FROM 'read' OR m.read_at IS NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_messages_read(uuid) TO authenticated;

-- ============================================================
-- DONE
-- ============================================================