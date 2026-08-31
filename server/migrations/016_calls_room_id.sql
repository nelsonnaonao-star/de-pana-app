-- FASE B: marcador de SALA de llamada (1:1 -> grupo).
-- Solo se setea en filas de `calls` creadas para la transición/invitación
-- grupal (room_id = roomId). Las llamadas 1:1 normales lo dejan NULL, por lo
-- que el flujo 1:1 (clasificacion isGroup=false) no cambia.
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
ALTER TABLE calls ADD COLUMN IF NOT EXISTS room_id UUID;