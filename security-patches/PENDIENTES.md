# Pendientes — 2026-11-10

Contexto: repo `de-pana-app` (público), Supabase prod `akgsylutbpgolurkcavh`.

## Retomar aquí
1. Revocar Tenor key (Google Cloud).
2. Restringir Firebase client key.
3. ~2026-11-12 22:26 UTC: forzar `min_supported_code=12` → aplicar `10b`.
4. Migración de media.
5. Ver `APP_URL` de kucq y limpiar `render.yaml:43`.

Hecho el 2026-11-09:
- Parche `07` aplicado: SELECT de `chat-images` retirado (no se puede listar).
- Trigger `send_fcm_notification` alineado al secreto que acepta el servidor
  (los push de mensajes vuelven a autenticar; antes daban `401`).

Estado 2026-11-10 (rotación aplicada y verificada):
- Los 3 triggers (`Call FCM Push`, `send_group_added_notification`,
  `send_fcm_notification`) apuntan a `de-pana-app-kucq.onrender.com` con el
  secreto nuevo. Verificado: nuevo `200`; viejo/sin secreto `401`.
- `redon-server.onrender.com` **suspendido** (HTTP 503). Era el crítico: su
  webhook no pedía secreto (aceptaba POST sin auth).
- `de-pana-app.onrender.com` sigue arriba (HTTP 200) pero es riesgo **bajo**:
  ningún APK actual ni trigger lo usa, y su secreto viejo no está en git.

## 1. Rotar secreto del webhook FCM (HECHO 2026-11-10)
- [x] Secreto nuevo generado y aplicado.
- [x] Triggers apuntando a `de-pana-app-kucq.onrender.com` con el secreto nuevo.
- [x] Verificado: nuevo `200`; viejo y sin secreto `401`.
- [x] Temporales (`fcm_secret.txt`, `rotate_apply.sql`) borrados.
- [x] Push real de mensaje y de llamada probado con la app cerrada: OK.

## 1b. Hosts viejos (verificado 2026-11-10)
- [x] `redon-server.onrender.com`: suspendido (503).
- [ ] `de-pana-app.onrender.com`: sigue vivo (200). Suspender cuando se tenga
      acceso; riesgo bajo. **Nunca suspender `de-pana-app-kucq`** (servidor
      activo).
- [x] Confirmado que ningún APK actual usa los hosts viejos (ver 1c).

## 1c. Auditoría de APKs (2026-11-10)
- `de-pana-app-kucq`: 1.2, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12 y WEPA 1.3.
- `de-pana-app`: solo legacy 1.0/1.1 y RedOn 1.0–1.3.1 (no trackeados).
- `redon-server`: ningún APK.
- Verificado leyendo el bundle JS de los APK publicados (1.5, 1.6, 1.11, 1.12)
  y de los locales. Los secretos viejos no aparecen en el historial de git.

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
- [ ] Verificar en Render que `APP_URL=https://de-pana-app-kucq.onrender.com`
      (links de recuperación de contraseña).
- [ ] Actualizar `render.yaml:43` (`VITE_SERVER_URL=redon-server`) o retirar el
      servicio `red-on`; hoy es la única referencia a ese host.
- [ ] Commitear `sql/14_...`, `runbooks/10b_window.md` y estos docs (hoy sin commit).

## Archivos clave
- `security-patches/sql/14_rotate_fcm_webhook_secret.sql`
- `security-patches/runbooks/10b_window.md`
- `security-patches/sql/10b_profiles_pii_revoke.sql`
- `security-patches/MEDIA_PRIVATE_DESIGN.md`
