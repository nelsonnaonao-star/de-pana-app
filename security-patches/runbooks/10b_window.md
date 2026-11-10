# Runbook - Ventana del parche 10b (revocar PII de `profiles`)

**Estado:** preparado, NO ejecutado.
**Objetivo:** quitar `email`, `phone_number` y `phone_digits` de `profiles` a
`anon`/`authenticated` sin romper la app.
**Archivo SQL:** `security-patches/sql/10b_profiles_pii_revoke.sql`

---

## 0. Resumen de la ventana

| Momento | Accion |
|---|---|
| T-72h | Forzar adopcion de 1.12 (`min_supported_code = 12`) |
| T-0 | Aplicar `10b` |
| T+5m | Verificaciones SQL |
| T+10m | Pruebas de app + Realtime |
| T+60m | Decision: mantener o rollback |
| T+24h | Revisar logs/Sentry/soporte |

---

## 1. Precondiciones

- [ ] 1.12 publicado y descargable (`app_releases.version_code = 12`).
- [ ] RPCs aplicadas: `get_my_profile`, `match_profiles_by_phones`,
      `get_public_profile`.
- [ ] Cliente 1.11+ en uso (la migracion a RPCs entro en 1.11). 1.12 anade HIBP.
- [ ] APKs 1.6+ incluyen el actualizador in-app: `src/services/appUpdate.ts`
      se introdujo el 2026-11-02, antes de 1.6 (2026-11-03) y 1.10 (2026-11-08).
- [ ] Riesgo residual aceptado: 1.5 (2026-11-01) **no** tiene actualizador y no
      se puede forzar; pocas instalaciones, avisar por soporte.

### Backup / linea base

Guardar la salida de:

```sql
SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY grantee, column_name;
```

Tomar ademas un backup desde el Dashboard (o confirmar el backup automatico del
proyecto) antes del cambio.

---

## 2. Forzar adopcion (T-72h)

```sql
UPDATE public.app_releases
SET min_supported_code = 12
WHERE version_code = 12;

SELECT version_code, version_name, mandatory, min_supported_code, active
FROM public.app_releases
WHERE active
ORDER BY version_code DESC;
```

Como funciona: `checkForAppUpdate()` (`src/services/appUpdate.ts:113`) marca la
actualizacion como obligatoria si `versionCode < min_supported_code`. Un equipo
en 11 vera el aviso obligatorio y pasara a 12; uno en 12 no vera nada.

> No desactivar las releases viejas: el updater necesita ver 12 como la ultima
> activa. Dejarlas `active = true`.

---

## 3. Aplicar 10b (T-0)

Opcion A (CLI):

```powershell
supabase db query -f security-patches/sql/10b_profiles_pii_revoke.sql --linked
```

Opcion B: pegar el contenido en el SQL Editor de Supabase (rol administrador).

---

## 4. Verificacion SQL (T+5m)

Debe devolver **0 filas**:

```sql
SELECT column_name, privilege_type, grantee
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND grantee IN ('anon', 'authenticated')
  AND column_name IN ('email', 'phone_number', 'phone_digits');
```

Simulacion como `authenticated` (debe fallar):

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
SELECT email FROM public.profiles LIMIT 1;  -- permission denied
ROLLBACK;
```

RPCs siguen funcionando (usar un `sub` real):

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"8482ffc4-c116-4c87-be2b-04774ba9d9ef","role":"authenticated"}', true);
SELECT * FROM public.get_my_profile();
SELECT * FROM public.match_profiles_by_phones(ARRAY['1555386424413'], 10);
SELECT * FROM public.get_public_profile('8482ffc4-c116-4c87-be2b-04774ba9d9ef');
ROLLBACK;
```

`service_role`/servidor no se ve afectado (el backend usa la service key).

---

## 5. Pruebas de app (T+10m, con 1.12)

- [ ] Login y carga de perfil propio (email/teléfono siguen visibles).
- [ ] Perfil de otro usuario: sin PII, sin errores.
- [ ] Sincronizacion de contactos (`device-contacts.ts`).
- [ ] Busqueda por telefono (>=7 digitos) por `match_profiles_by_phones`.
- [ ] Busqueda por nombre/username (`contacts.ts searchUsers`).
- [ ] Escaner QR -> `get_public_profile`.
- [ ] `PhoneSimulator.handleOpenProfile` abre el perfil.
- [ ] Enviar/recibir mensaje y notificacion push.
- [ ] Realtime de `profiles` (ver seccion 6).

---

## 6. Realtime de `profiles`

Suscripcion: `src/contexts/SupabaseContext.tsx:754-792`
(`event: UPDATE`, tabla `profiles`). Solo usa `id`, `status`, `avatar_url`,
`avatar`, `name` (columnas publicas), asi que el revoke no deberia romperla.

Prueba:

1. Equipo A logueado, con la lista de chats abierta.
2. Desde SQL (o equipo B): actualizar el perfil de B:

```sql
UPDATE public.profiles
SET status = 'online', updated_at = now()
WHERE id = '<ID_DE_B>';
```

3. En A debe cambiar el estado/avatar/nombre de B sin recargar.
4. Revisar consola de A y logs de Realtime: sin `CHANNEL_ERROR`.

Si falla de forma persistente: rollback (seccion 7) y revisar publicacion/RLS de
Realtime antes de reintentar.

---

## 7. Monitoreo y rollback

Monitorear 60 min:

- Render: errores 5xx y `[FCM-WEBHOOK]`.
- Sentry: errores nuevos en 1.12.
- Soporte: "no carga el perfil/contactos".

Rollback (restaura las tres columnas a ambos roles):

```sql
BEGIN;

GRANT SELECT (email, phone_number, phone_digits)
  ON TABLE public.profiles TO authenticated;

GRANT SELECT (email, phone_number, phone_digits)
  ON TABLE public.profiles TO anon;

COMMIT;
```

Verificar que la consulta de la seccion 4 vuelve a devolver filas y que la app
deja de fallar. Mantener `min_supported_code = 12` (no hace dano).

---

## 8. Post-ventana

- [ ] Dejar `min_supported_code = 12` para las fases siguientes.
- [ ] Siguiente: migracion de media (`MEDIA_PRIVATE_DESIGN.md`).
- [ ] En paralelo: rotar webhook (`security-patches/sql/14_rotate_fcm_webhook_secret.sql`).
