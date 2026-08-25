-- ============================================================
-- PRESENCE CLEANUP: Server-side stale presence detection
-- ============================================================
-- Ejecutar en: Supabase SQL Editor ( orden importa )

-- 1) Habilitar pg_cron PRIMERO (antes de cualquier uso)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2) Limpiar schedule anterior si existe
SELECT cron.unschedule('clean-stale-presence') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'clean-stale-presence'
);

-- 3) Tabla de heartbeat
CREATE TABLE IF NOT EXISTS user_presence (
  user_id     uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  last_seen   timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline'))
);

ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "presence_select_auth" ON user_presence;
CREATE POLICY "presence_select_auth"
  ON user_presence FOR SELECT
  TO authenticated
  USING (true);

-- 4) Función de limpieza
CREATE OR REPLACE FUNCTION clean_stale_presence()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE user_presence
  SET    status = 'offline'
  WHERE  status = 'online'
    AND  last_seen < now() - interval '2 minutes';

  UPDATE profiles p
  SET    status = up.status
  FROM   user_presence up
  WHERE  p.id = up.user_id
    AND  p.status != up.status;
END;
$$;

-- 5) Cron: cada minuto
SELECT cron.schedule(
  'clean-stale-presence',
  '* * * * *',
  $$SELECT clean_stale_presence()$$
);

-- 6) Verificar
SELECT * FROM cron.job WHERE jobname = 'clean-stale-presence';
