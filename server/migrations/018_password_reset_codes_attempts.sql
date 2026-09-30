-- Fase 1 seguridad recuperación de contraseña: límite de intentos por código.
-- Agrega un contador de intentos fallidos por código de recuperación
-- (máximo 5; pasado el límite el código queda inutilizable).
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
ALTER TABLE password_reset_codes ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;