-- ============================================================================
-- Actualizaciones in-app (sideload, sin Play Store)
-- Ejecutar UNA vez en el SQL Editor de Supabase.
-- No modifica tablas existentes: solo crea bucket + tabla nueva.
-- ============================================================================

-- 1) Bucket público con los APK.
--    Público = lectura anónima del objeto (normal para sideload).
--    La escritura queda reservada al service_role (el script de publicación).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'app-updates',
  'app-updates',
  true,
  314572800, -- 300 MB
  array['application/vnd.android.package-archive', 'application/octet-stream']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 2) Catálogo de versiones publicadas.
create table if not exists public.app_releases (
  id                 uuid primary key default gen_random_uuid(),
  version_code       integer not null unique,
  version_name       text not null,
  apk_path           text not null,
  apk_size           bigint,
  notes              text,
  mandatory          boolean not null default false,
  min_supported_code integer not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

comment on table public.app_releases is
  'Versiones de la app publicadas para actualización in-app vía Supabase Storage.';

create index if not exists app_releases_active_version_idx
  on public.app_releases (active, version_code desc);

-- 3) RLS: la app (anon/authenticated) solo puede LEER releases activas.
--    INSERT/UPDATE/DELETE quedan solo para service_role (bypass RLS).
alter table public.app_releases enable row level security;

drop policy if exists "app_releases_public_read" on public.app_releases;
create policy "app_releases_public_read"
  on public.app_releases
  for select
  to anon, authenticated
  using (active = true);

-- 4) Lectura pública de los APK del bucket (defensa extra; el bucket ya es public).
drop policy if exists "app_updates_public_read" on storage.objects;
create policy "app_updates_public_read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'app-updates');

-- ============================================================================
-- Verificación rápida (opcional):
--   select version_code, version_name, mandatory, active, created_at
--   from public.app_releases order by version_code desc;
-- ============================================================================
