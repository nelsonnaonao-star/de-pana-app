-- Sonido de notificación personalizado por grupo/chat.
-- NULL = sonido global (comportamiento por defecto).
-- Un valor como 'noti1', 'noti2', etc. = sonido específico.
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
ALTER TABLE chats ADD COLUMN IF NOT EXISTS notification_sound TEXT DEFAULT NULL;
