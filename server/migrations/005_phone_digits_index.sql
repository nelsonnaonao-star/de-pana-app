-- Migración: Agregar columna phone_digits con índice para búsquedas eficientes
-- Ejecutar en Supabase SQL Editor

-- 1. Agregar columna normalizada (solo dígitos)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_digits text;

-- 2. Poblar con los datos existentes (solo dígitos)
UPDATE profiles SET phone_digits = regexp_replace(COALESCE(phone_number, ''), '[^0-9]', '', 'g');

-- 3. Crear índice para búsquedas exactas
CREATE INDEX IF NOT EXISTS idx_profiles_phone_digits ON profiles (phone_digits);

-- 4. Trigger para mantener phone_digits sincronizado al INSERT/UPDATE
CREATE OR REPLACE FUNCTION sync_phone_digits()
RETURNS TRIGGER AS $$
BEGIN
  NEW.phone_digits := regexp_replace(COALESCE(NEW.phone_number, ''), '[^0-9]', '', 'g');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_phone_digits ON profiles;
CREATE TRIGGER trg_sync_phone_digits
  BEFORE INSERT OR UPDATE OF phone_number ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION sync_phone_digits();
