-- ============================================================
-- PARCHE 14 - Rotar el secreto del webhook FCM
-- Fecha: 2026-11-09
--
-- ESTADO: PLANTILLA. NO EJECUTAR TAL CUAL.
--   Reemplaza REEMPLAZA_CON_SECRETO_NUEVO en la linea `v_secret text := ...`.
--   Si el placeholder sigue ahi, el bloque aborta con excepcion.
--
-- Contexto (verificado en pg_trigger):
--   - calls ................ un secreto debil y predecible (secreto viejo)
--   - chat_participants .... el mismo secreto debil
--   - messages ............. otro secreto aleatorio (secreto viejo)
--   El servidor solo acepta UNO (FCM_WEBHOOK_SECRET), asi que al menos una
--   de las dos rutas ya recibe 401. Esta rotacion unifica las tres.
--
-- ESTADO ACTUAL (2026-11-09): se confirmo que `messages` daba 401 y se alineo
-- temporalmente su trigger al secreto aceptado para restaurar los push. Los
-- tres triggers siguen usando el secreto debil; esta rotacion los pasa al
-- secreto nuevo y elimina el debil.
--
-- PASO 0 - Guarda las definiciones actuales (por si hay que revertir):
--   SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
--   FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE NOT t.tgisinternal
--     AND t.tgname IN ('Call FCM Push','send_group_added_notification','send_fcm_notification');
--
-- Orden obligatorio:
--   1) Generar secreto: openssl rand -hex 32  (64 chars hex).
--   2) Render -> red-on -> Environment -> FCM_WEBHOOK_SECRET = <nuevo>.
--      Esperar a que termine el redeploy.
--   3) Editar v_secret aqui y ejecutar:
--        supabase db query -f security-patches/sql/14_rotate_fcm_webhook_secret.sql --linked
--      (o pegar en el SQL Editor de Supabase).
--   4) Verificar y probar (abajo).
--
-- Ventana: entre (2) y (3), los triggers viejos mandan el secreto viejo y el
-- servidor espera el nuevo => 401. Son segundos/minutos; se pierden solo las
-- notificaciones generadas en esa ventana.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_secret  text := 'REEMPLAZA_CON_SECRETO_NUEVO';
  v_url     text := 'https://de-pana-app.onrender.com/api/fcm/webhook';
  v_headers text;
BEGIN
  IF v_secret = 'REEMPLAZA_CON_SECRETO_NUEVO' OR length(v_secret) < 32 THEN
    RAISE EXCEPTION 'Define un secreto nuevo (>=32 chars) en v_secret antes de ejecutar';
  END IF;

  v_headers := jsonb_build_object(
    'Content-type', 'application/json',
    'x-fcm-secret', v_secret
  )::text;

  EXECUTE 'DROP TRIGGER IF EXISTS "Call FCM Push" ON public.calls';
  EXECUTE format(
    'CREATE TRIGGER "Call FCM Push" AFTER INSERT OR UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000'
  );

  EXECUTE 'DROP TRIGGER IF EXISTS send_group_added_notification ON public.chat_participants';
  EXECUTE format(
    'CREATE TRIGGER send_group_added_notification AFTER INSERT ON public.chat_participants FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000'
  );

  EXECUTE 'DROP TRIGGER IF EXISTS send_fcm_notification ON public.messages';
  EXECUTE format(
    'CREATE TRIGGER send_fcm_notification AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, %L, %L, %L, %L)',
    v_url, 'POST', v_headers, '{}', '5000'
  );
END $$;

COMMIT;

-- ============================================================
-- VERIFICACION (no debe aparecer ningun secreto viejo)
-- ============================================================
-- SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
-- FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
-- WHERE NOT t.tgisinternal
--   AND t.tgname IN ('Call FCM Push','send_group_added_notification','send_fcm_notification');
--
-- Prueba HTTP (sin secreto => 401; con secreto nuevo => 200):
--   Invoke-WebRequest -Method POST `
--     -Uri https://de-pana-app.onrender.com/api/fcm/webhook `
--     -Headers @{ "x-fcm-secret" = "<nuevo>"; "Content-Type" = "application/json" } `
--     -Body '{"type":"INSERT","table":"messages","record":{"id":"00000000-0000-0000-0000-000000000000"}}'
--
-- ============================================================
-- ROLLBACK (recrear con los secretos viejos)
-- ============================================================
-- Usa las definiciones que guardaste en el PASO 0. No escribas secretos en
-- el repo: copia el `pg_get_triggerdef` original y vuelve a ejecutarlo tal cual.
-- Ejemplo de forma (reemplaza SECRETO_VIEJO_*):
--
-- DROP TRIGGER IF EXISTS "Call FCM Push" ON public.calls;
-- CREATE TRIGGER "Call FCM Push" AFTER INSERT OR UPDATE ON public.calls FOR EACH ROW
--   EXECUTE FUNCTION supabase_functions.http_request('https://de-pana-app.onrender.com/api/fcm/webhook', 'POST', '{"Content-type":"application/json","x-fcm-secret":"SECRETO_VIEJO_CALLS"}', '{}', '5000');
-- DROP TRIGGER IF EXISTS send_group_added_notification ON public.chat_participants;
-- CREATE TRIGGER send_group_added_notification AFTER INSERT ON public.chat_participants FOR EACH ROW
--   EXECUTE FUNCTION supabase_functions.http_request('https://de-pana-app.onrender.com/api/fcm/webhook', 'POST', '{"Content-type":"application/json","x-fcm-secret":"SECRETO_VIEJO_CALLS"}', '{}', '5000');
-- DROP TRIGGER IF EXISTS send_fcm_notification ON public.messages;
-- CREATE TRIGGER send_fcm_notification AFTER INSERT ON public.messages FOR EACH ROW
--   EXECUTE FUNCTION supabase_functions.http_request('https://de-pana-app.onrender.com/api/fcm/webhook', 'POST', '{"Content-type":"application/json","x-fcm-secret":"SECRETO_VIEJO_MESSAGES"}', '{}', '5000');
