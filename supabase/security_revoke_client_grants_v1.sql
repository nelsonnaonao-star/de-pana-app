-- ============================================================================
-- Endurecimiento de grants: quitar acceso directo de clientes a tablas internas
-- Ejecutar UNA vez en el SQL Editor de Supabase (producción).
--
-- Motivo:
--   - password_reset_codes: solo la usa el servidor (service_role).
--   - admins: solo la usa el servidor (service_role).
--   - calls: los clientes autenticados la necesitan; anon NO.
-- RLS ya filtraba, esto elimina la superficie a nivel de privilegios.
-- ============================================================================

revoke all privileges on table public.password_reset_codes from anon, authenticated;
revoke all privileges on table public.admins from anon, authenticated;
revoke all privileges on table public.calls from anon;

-- service_role conserva acceso (bypass RLS) para el backend.
grant all privileges on table public.password_reset_codes to service_role;
grant all privileges on table public.admins to service_role;
grant all privileges on table public.calls to service_role;

-- ============================================================================
-- Verificación (no debe aparecer anon en ninguna de las tres tablas):
--   select table_name, grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('password_reset_codes', 'admins', 'calls')
--   order by table_name, grantee, privilege_type;
-- ============================================================================
