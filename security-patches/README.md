# Parches de seguridad — DE PANA

Estos parches están preparados para revisión y aplicación manual.

> **Estado actual — 2026-11-09:** aplicados y verificados en producción `02`,
> `05`, `07`, `10a`, `11`, `12` y `13`. El cliente ya fue migrado a las RPCs de
> perfiles (`get_my_profile`, `match_profiles_by_phones`, `get_public_profile`)
> y salió 1.12 con el chequeo HIBP. **`10b` NO se aplica hasta forzar/adoptar
> 1.12.** La migración de media (`01`) sigue pendiente (dry-run hecho).

## Contenido

| # | Punto | Archivos | Estado |
|---|-------|----------|--------|
| 01 | Media de chats en bucket público | `patches/01_media_private.patch`, `scripts/migrate-chat-images-to-private.mjs`, `sql/01_media_verification.sql` | Congelado |
| 02 | Chats: bloquear `admin_id`/`profile_id`/`is_group` | `sql/02_chats_guard_trigger.sql` | Aplicado y verificado (2026-11-02) |
| 03 | `/unmute` sin authz + mute global | `patches/03_mute_per_user.patch`, `sql/03_chat_mutes_per_user.sql` | Congelado |
| 04 | `vote-poll` sobrescribe votos ajenos | `patches/04_vote_poll.patch` | Congelado |
| 05 | SSRF en `/api/link-preview` | `patches/05_link_preview.patch` | Aplicado (`96f0fcd`) — verificar deploy |
| 06 | Hardening `NODE_ENV` | `patches/06_node_env.patch` | Congelado |
| 07 | Políticas amplias de `chat-images` | `sql/07_chat_images_policies.sql` | Aplicado (solo SELECT) — 2026-11-09 |
| 10a | RPCs seguras de perfiles | `sql/10a_profiles_public_rpcs.sql` | Aplicado y verificado (2026-11-09) |
| 10b | Revocar PII (`email`/teléfono) de `profiles` | `sql/10b_profiles_pii_revoke.sql` | **Pendiente de deploy del cliente** |
| 11 | Cerrar tablas legacy y `anon` en `contacts` | `sql/11_close_legacy_tables.sql` | Aplicado y verificado (2026-11-09) |
| 12 | `search_path` + EXECUTE de anon | `sql/12_function_hardening.sql` | Aplicado y verificado (2026-11-09) |
| 13 | Revocar RPC legacy `search_users` (email/pin) | `sql/13_revoke_search_users.sql` | Aplicado y verificado (2026-11-09) |

## Aplicados

1. **`sql/02_chats_guard_trigger.sql`** — **aplicado y verificado** el
   2026-11-02: `guard_sensitive_chat_fields` existe, está habilitado
   (`tgenabled = O`) y es `BEFORE UPDATE` sobre `public.chats`. Cierra el
   autoascenso a administrador. Es idempotente; no reaplicar salvo rollback.
2. **`patches/05_link_preview.patch`** — añade auth, DNS y límite de tamaño a
   `/api/link-preview`. **Ya aplicado** en el commit `96f0fcd`; no reaplicar.
   Falta desplegar el servidor y verificar.
3. **`sql/10a_profiles_public_rpcs.sql`** — aplicado 2026-11-09. Crea
   `get_my_profile()` y `match_profiles_by_phones(text[], int)`; solo
   `authenticated`/`service_role`. Verificado con simulación de rol.
4. **`sql/11_close_legacy_tables.sql`** — aplicado 2026-11-09. 0 policies en
   tablas legacy, 0 privilegios de `anon` en `contacts`, 0 acceso de cliente a
   `call_signals`.
5. **`sql/12_function_hardening.sql`** — aplicado 2026-11-09. 0 funciones sin
   `search_path`; funciones de trigger/utilidad no ejecutables por `anon`.
6. **`sql/13_revoke_search_users.sql`** — aplicado 2026-11-09. `search_users`
   (enumeraba email/pin) sin EXECUTE para `anon`/`authenticated`.
7. **Cliente de perfiles** — migrado a RPCs: `SupabaseContext.tsx`,
   `auth.ts`, `device-contacts.ts`, `contacts.ts`, `QrScanner.tsx` y
   `PhoneSimulator.tsx`. Desplegado en 1.11 y 1.12.
8. **`sql/10b_profiles_pii_revoke.sql`** — **NO aplicado**. Ejecutar solo tras
   forzar/adoptar 1.12 (APKs antiguos y Realtime de `profiles`).
9. **`sql/07_chat_images_policies.sql`** — aplicado 2026-11-09. Elimina solo
   `"Allow authenticated downloads"` (SELECT de `chat-images`); conserva el
   INSERT. Verificado: 0 policies SELECT en `chat-images` y 20 totales.

## Congelado (no aplicar todavía)

- **01:** endpoints legacy `/api/media/upload` y `/compress-video`. No se toca
  hasta validar 02 y 05. Puede romper versiones antiguas que aún los llamen.
- **03 + SQL 03:** cambio de modelo de mute a por usuario. Es cambio de producto;
  el impacto del `/unmute` sin authz es bajo.
- **04:** integridad de encuestas; no es urgente.
- **06:** producción ya está protegida (verificado: `/api/auth/auto-confirm`
  responde `403`). Es hardening.
- **Migración de media (`01`):** script corregido (4 columnas: `image_url`,
  `video_url`, `audio_url`, `file_url`; stickers/GIFs quedan públicos).
  Dry-run 2026-11-09: **382 mensajes, 381 objetos, 28 chats**
  (image 52, video 42, audio 284, file 4). **No se ha migrado nada.** Antes de
  `--apply`, desplegar el cliente que firma URLs y coordinar versiones antiguas.
- **SQL 07 (cierre total):** no aplicar aún. El SELECT ya está cerrado; falta
  retirar INSERT y migrar la media. Ver abajo.

## SQL 07 — aplicado (solo SELECT, 2026-11-09)

El SQL 07 original eliminaba INSERT, SELECT y DELETE. Eso **rompe** las subidas
de avatares, flyers, avatares de grupo y stickers porque
`src/services/storage.ts` usa `supabase.storage.from('chat-images').upload(...)`
directamente desde el cliente.

La versión aplicada:

- Elimina **solo** `"Allow authenticated downloads"` (SELECT): cierra el listado
  y la lectura vía API de todo el bucket.
- **Mantiene** `"Allow authenticated uploads"` (INSERT) y
  `"Allow users to delete own files"` (DELETE).
- Las fotos viejas siguen accesibles por URL pública; el cierre total es la
  migración a `chat-media` privado.
- El cierre total (quitar INSERT) requiere mover `uploadChatMedia` a un endpoint
  del servidor con `service_role`. Eso queda pendiente.

## Share target Android (preparado, no aplicado)

- Patch combinado: `patches/08_share_target.patch`.
- Copias independientes: `share-target/`.
- Añade `ACTION_SEND` / `ACTION_SEND_MULTIPLE` para `image/*` a `MainActivity`,
  sin tocar `ANSWER_CALL` ni `OPEN_APP`.
- Copia los `content://` a `cacheDir/shared` y expone las rutas a JS mediante el
  plugin `ShareReceiver`.
- No requiere permisos nuevos ni dependencias Gradle.
- `git apply --check` pasa; **no está aplicado** y no se ha compilado.

## Advertencias

- **02:** si el trigger ya existía, el script lo reemplaza sin romper nada.
- **05:** ya aplicado en `96f0fcd`. El cliente actual no usa `/api/link-preview`;
  versiones antiguas que lo llamen sin token recibirán `401`. Queda el riesgo
  residual de DNS rebinding (TOCTOU), mitigado pero no eliminado.
- **01 (futuro):** clientes antiguos que llamen a `/api/media/upload` o
  `/compress-video` sin `chat_id` recibirán `400`.
- **03 (futuro):** se eliminan las filas antiguas de `chat_mutes` sin `muted_by`
  porque no se puede atribuir su autor. Exportarlas antes si se quieren conservar.
- **SQL:** ejecutar en el SQL Editor de Supabase con un rol administrador. Hacer
  backup antes.

## Verificación rápida

- **02:** `SELECT tgname, tgenabled, pg_get_triggerdef(t.oid) FROM pg_trigger t
  WHERE t.tgrelid = 'public.chats'::regclass
    AND t.tgname = 'guard_sensitive_chat_fields';`
  Resultado 2026-11-02: 1 fila, `tgenabled = O`, `BEFORE UPDATE`.
- **05:** `POST /api/link-preview` sin token debe dar `401`; `http://127.0.0.1`,
  `http://169.254.169.254` y un dominio que resuelva a IP privada deben dar `400`.
- **07 (aplicado 2026-11-09):** `"Allow authenticated uploads"` sigue existiendo
  y `"Allow authenticated downloads"` ya no; 0 policies SELECT con
  `bucket_id = 'chat-images'`.
- **Media (solo si se migra):** contar mensajes con `/chat-images/`; después debe
  ser 0.

## Rollback

- Código 05: `git revert 96f0fcd` (o revertir solo `server/src/index.js` y
  `server/src/routes/linkpreview.js`).
- SQL 02: `DROP TRIGGER IF EXISTS guard_sensitive_chat_fields ON public.chats;`
- SQL 07 (si se revierte): recrear la política SELECT desde
  `server/migrations/004_storage_rls.sql`.
- Media: los originales se conservan salvo que se use `--delete-originals`.
