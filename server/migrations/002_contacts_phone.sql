-- Ejecutar en el SQL Editor de Supabase Dashboard
-- Hace contact_user_id nullable y agrega columna phone para contactos sin cuenta RED ON

ALTER TABLE contacts ALTER COLUMN contact_user_id DROP NOT NULL;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';
