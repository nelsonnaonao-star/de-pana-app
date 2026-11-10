# Pendientes — 2026-11-10

Contexto: repo `de-pana-app` (público), Supabase prod `akgsylutbpgolurkcavh`.

Hecho el 2026-11-09:
- Parche `07` aplicado: SELECT de `chat-images` retirado (no se puede listar).
- Trigger `send_fcm_notification` alineado al secreto que acepta el servidor
  (los push de mensajes vuelven a autenticar; antes daban `401`).

## 1. Rotar secreto del webhook FCM (prioridad alta)
- [ ] Generar secreto nuevo (64 hex):
      `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')`
- [ ] Render → `red-on` → Environment → `FCM_WEBHOOK_SECRET` = nuevo; esperar redeploy.
- [ ] Editar `v_secret` en `sql/14_rotate_fcm_webhook_secret.sql` y ejecutarlo.
- [ ] Verificar: ningún trigger contiene los secretos viejos; POST sin secreto
      `401`, con el nuevo `200`.
- Nota: hoy los 3 triggers usan el secreto débil actual (el que el servidor acepta).

## 2. Revocar Tenor key (prioridad alta)
- [ ] Google Cloud → APIs & Services → Credentials → borrar/revocar la key
      `AIza...` que estuvo en `src/services/stickerService.ts` (commit `e2daadd`,
      repo público). La app ya no usa Tenor.

## 3. Restringir Firebase client key (media)
- [ ] Google Cloud → restringir por package `com.redon.app` + SHA-1 / referrers.
      No es un secreto de servidor (va en el APK), pero el repo es público.

## 4. En 72h: forzar 1.12 y ventana 10b
- [ ] `UPDATE public.app_releases SET min_supported_code = 12 WHERE version_code = 12;`
- [ ] Seguir `runbooks/10b_window.md`: backup, aplicar `10b`, verificar SQL,
      probar app/Realtime, monitorear y rollback listo.

## 5. Después: migración de media
- [ ] Seguir `MEDIA_PRIVATE_DESIGN.md` y `scripts/migrate-chat-images-to-private.mjs`.
- [ ] `--apply` sin borrar → verificar → 7 días → borrar originales → bucket privado.

## 6. Opcional / no urgente
- [ ] Auditar el historial de `redon-server-` (también público).
- [ ] Evaluar pasar repos a privados (ojo: los APKs 1.5/1.6 se descargan de
      GitHub Releases; privado rompería esas URLs).
- [ ] No reescribir el historial: rotar las claves es la solución real.
- [ ] Commitear `sql/14_...`, `runbooks/10b_window.md` y estos docs (hoy sin commit).

## Archivos clave
- `security-patches/sql/14_rotate_fcm_webhook_secret.sql`
- `security-patches/runbooks/10b_window.md`
- `security-patches/sql/10b_profiles_pii_revoke.sql`
- `security-patches/MEDIA_PRIVATE_DESIGN.md`
