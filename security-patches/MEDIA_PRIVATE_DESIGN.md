# Diseño — Migración de media de chat a bucket privado (punto 2)

Fecha: 2026-11-09
Proyecto verificado: `akgsylutbpgolurkcavh` ("On chat")

## 1. Estado actual (verificado en producción)

| Bucket | Público | Objetos | Uso |
|---|---:|---:|---|
| `chat-images` | **sí** | **505** | media legado de chat + avatares + stickers + flyers |
| `chat-media` | no (privado) | 12 | media nueva de conversaciones (signed URLs) |
| `chat-files` | no (privado) | 72 | archivos de chat |
| `voice-notes` | no (privado) | 51 | notas de voz |
| `moments` | no (privado) | 37 | historias/momentos |
| `avatars` | sí | 16 | avatares |
| `business-flyers` | sí | 45 | flyers |
| `stickers` | sí | 10 | stickers |
| `stickers_oficiales` | sí | 30 | stickers oficiales |
| `music` / `music-files` | sí | 9 / 1 | música |
| `flyer-templates` | sí | — | plantillas |
| `app-updates` | sí | 1 | APK/updates |
| `backups` | no (privado) | 2 | backups |

Problema: `chat-images` es **público** y contiene fotos/videos de conversaciones
antiguas. Cualquiera con la URL (sin login) las descarga. Además, cualquier
usuario autenticado puede subir a ese bucket sin control por chat.

## 2. Objetivo

- Media de conversaciones (imagen, video, audio, archivo, nota de voz) → bucket
  **privado `chat-media`**, servido con **signed URLs** de corta duración y
  validando pertenencia al chat.
- Avatares, stickers y flyers → buckets públicos dedicados que ya existen
  (`avatars`, `stickers`, `business-flyers`), no `chat-images`.
- `chat-images` queda **vacío y privado** o se desmantela.

## 3. Infraestructura ya disponible (reutilizar, no reinventar)

- `server/src/routes/media.js:356` — `POST /api/media/upload-private`
  sube a `chat-media/<chat_uuid>/<uuid>.<ext>` con `service_role` y valida
  pertenencia al chat (`requireChatMembership`).
- `server/src/routes/media.js:371` — `POST /api/media/upload-private-video`.
- `server/src/routes/media.js:544` — `POST /api/media/signed-url`:
  - Modo A `{ messageId }`: valida que el usuario sea miembro del chat y firma
    `image_url`, `audio_url`, `video_url`, `file_url`.
  - Modo B `{ urls: [...] }`: autoriza rutas (`authorizeStoragePaths`) y firma
    hasta 20 URLs.
- `server/src/lib/privateUpload.js` — límites de tamaño/MIME, paths por chat.
- `server/src/lib/storageRefs.js` — clasifica por bucket explícito y exige que
  una ref de `chat-media` empiece por `<chat_uuid>/` (`isPrivateRefForChat`).
- `src/services/privateUploadClient.ts` + `src/services/storage.ts:177`
  (`uploadPrivateChatMedia`) — cliente que sube por `authUpload`.

Conclusión: la ruta privada **ya funciona** para media nueva. El trabajo es
migrar lo viejo y cortar las rutas que aún escriben/leen `chat-images`.

## 4. Brechas a cerrar

1. `src/services/storage.ts:6` — `BUCKET = "chat-images"`; `uploadChatMedia`
   (`:150`) y `uploadAvatar` (`:159`) siguen subiendo **directo** a
   `chat-images`.
2. Endpoints legacy siguen escribiendo a `chat-images`:
   - `server/src/routes/media.js:273` — `/api/media/upload`
   - `server/src/routes/media.js:137` — `/compress-video`
   - `server/src/routes/media.js:205` — `/trim-video`
3. Mensajes antiguos referencian URLs públicas de `chat-images` en
   `image_url`, `video_url`, `audio_url`, `file_url`. (`sticker_url`/`gif_url`
   son contenido público y NO se migran.)
4. El script `security-patches/scripts/migrate-chat-images-to-private.mjs`
   procesaba la columna **`attachment_url`** (ya no existe). Ya fue corregido
   para cubrir las 4 columnas de media reales.
5. `storage.objects` para `chat-images` permite a `authenticated`
   SELECT e INSERT sin scoping por carpeta.

## 5. Plan por fases

### Fase 0 — Inventario y backup (sin cambios)
- Contar referencias por columna y bucket:
  ```sql
  SELECT 'image_url' col, count(*) FROM public.messages WHERE image_url ILIKE '%/chat-images/%'
  UNION ALL SELECT 'video_url', count(*) FROM public.messages WHERE video_url ILIKE '%/chat-images/%'
  UNION ALL SELECT 'audio_url', count(*) FROM public.messages WHERE audio_url ILIKE '%/chat-images/%'
  UNION ALL SELECT 'file_url',  count(*) FROM public.messages WHERE file_url  ILIKE '%/chat-images/%';
  -- sticker_url y gif_url son contenido público: NO se migran.
  ```
- Listar objetos por prefijo (`storage.foldername(name)`) para separar
  avatares/stickers/flyers de media de chat.
- Exportar metadatos (no binarios) de `storage.objects` de `chat-images`.

### Fase 1 — Extender el script de migración
`migrate-chat-images-to-private.mjs` (ya corregido):
- Recorre las 4 columnas de media (`image_url`, `video_url`, `audio_url`,
  `file_url`) y agrupa por objeto + chat.
- Por cada objeto referenciado: descargar de `chat-images`, subir a
  `chat-media/<chat_id>/<uuid><ext>`, y actualizar **solo la(s) columna(s)**
  donde estaba referenciado.
- Dry-run obligatorio antes de `--apply`.
- No borrar originales hasta que `count(refs) = 0` en las 4 columnas.

### Fase 2 — Corte de subida (media nueva)
- `storage.ts`: reemplazar `uploadChatMedia`/`uploadAvatar` directos a
  `chat-images` por:
  - media de chat → `uploadPrivateChatMedia` (ya existe).
  - avatar → bucket `avatars` (público) o endpoint server con `service_role`.
  - stickers/flyers → sus buckets dedicados.
- Endpoints legacy `/api/media/upload`, `/compress-video`, `/trim-video`:
  - mantener para versiones antiguas pero redirigiendo a `chat-media`, **o**
  - retirarlos cuando las versiones antiguas dejen de usarse (coordinar con
    el mínimo de versión soportada).
- Prohibir que `chat-images` reciba subidas nuevas.

### Fase 3 — Lectura dual y signed URLs
- El cliente pide URLs firmadas vía `POST /api/media/signed-url`:
  - por `messageId` al renderizar mensajes (recomendado), o
  - por `urls[]` para compatibilidad.
- Cachear la URL firmada por su TTL (`SIGNED_URL_TTL`) y renovar antes de
  expirar; fallback a descarga con token si falla.
- Offline: guardar el objeto en caché local, no la URL firmada.

### Fase 4 — Cerrar/migrar `chat-images`
1. Mover avatares/stickers/flyers restantes a sus buckets.
2. Verificar 0 referencias a `chat-images` en las 4 columnas de media.
3. El SELECT ya está retirado (`07`, 2026-11-09). Pendiente: quitar el INSERT y
   poner el bucket en `public = false` cuando la media esté migrada.
4. Opcional: borrar el bucket `chat-images` cuando esté vacío.

Policies objetivo (stretch):
```sql
-- chat-media: privado; sin policies para anon/authenticated.
-- (acceso solo vía service_role/signed URLs)
-- chat-images: SELECT ya retirado (07, 2026-11-09).
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
-- y poner el bucket public=false desde el Dashboard cuando esté vacío.
```
> Nota: `public = true` en un bucket hace que la ruta
> `/storage/v1/object/public/...` ignore RLS. Para que una foto de chat deje de
> ser pública hay que **poner el bucket en privado** y mover el objeto a
> `chat-media`; quitar solo policies no basta.

### Fase 5 — Limpieza
- Borrar originales de `chat-images` solo con 0 referencias.
- Recontar objetos y referencias.
- Actualizar `docs/PLAN_SEGURIDAD_PENDIENTE.md`.

## 6. Rollback

- El script no borra originales por defecto (`--delete-originals` explícito).
- Las columnas de `messages` se actualizan por fila; guardar un CSV
  `(message_id, columna, url_original)` antes de `--apply` para poder revertir.
- Si se corta `chat-images` y algo falla: volver a `public = true` y restaurar
  la policy de lectura temporalmente (solo durante la ventana de rollback).

## 7. Criterios de aceptación

- 0 mensajes con `%/chat-images/%` en las 4 columnas de media.
- 0 objetos en `chat-images` (o solo avatares/stickers/flyers justificados).
- `chat-images.public = false` (o bucket eliminado).
- `/api/media/signed-url` responde `403` a no-miembros y `200` a miembros.
- Un usuario autenticado **no** puede listar ni descargar media de un chat
  ajeno (probar con dos cuentas).
- App: imágenes/videos/audios/archivos y notas de voz siguen reproduciéndose
  en chats 1:1 y grupos, online y tras reconexión.

## 8. Riesgos

- **Versiones antiguas** que llaman a `/api/media/upload`: mantener el endpoint
  hasta cumplir la política de versión mínima.
- **Expiración de signed URLs** durante reproducciones largas: TTL holgado +
  renovación.
- **Costo/egress** de re-descargar y re-subir 505 objetos: hacerlo por lotes y
  en horario de baja actividad.
- **Objetos huérfanos** (sin referencia en `messages`): clasificar antes de
  borrar; pueden ser avatares/stickers usados en otras tablas.
