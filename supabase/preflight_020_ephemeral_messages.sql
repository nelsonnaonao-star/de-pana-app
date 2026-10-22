BEGIN TRANSACTION READ ONLY;

SELECT
  'execution_context' AS section,
  current_user AS current_user,
  session_user AS session_user,
  (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS current_user_superuser,
  has_schema_privilege(current_user, 'public', 'USAGE') AS current_user_public_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') AS current_user_public_create,
  to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_exists,
  CASE
    WHEN to_regnamespace('auth') IS NULL THEN false
    ELSE has_schema_privilege(current_user, 'auth', 'USAGE')
  END AS current_user_auth_usage,
  CASE
    WHEN to_regprocedure('auth.uid()') IS NULL THEN false
    ELSE has_function_privilege(current_user, 'auth.uid()', 'EXECUTE')
  END AS current_user_auth_uid_execute,
  to_regclass('public.messages') IS NOT NULL AS messages_exists,
  to_regclass('public.chats') IS NOT NULL AS chats_exists,
  to_regclass('public.chat_participants') IS NOT NULL AS participants_exists,
  to_regclass('public.chat_clears') IS NOT NULL AS clears_exists,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS anon_role_exists,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AS authenticated_role_exists,
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS service_role_exists;

WITH required(schema_name, table_name, column_name) AS (
  VALUES
    ('public', 'messages', 'id'),
    ('public', 'messages', 'chat_id'),
    ('public', 'messages', 'is_deleted'),
    ('public', 'messages', 'is_ephemeral'),
    ('public', 'messages', 'ephemeral_expires_at'),
    ('public', 'messages', 'created_at'),
    ('public', 'chats', 'id'),
    ('public', 'chats', 'profile_id'),
    ('public', 'chats', 'admin_id'),
    ('public', 'chats', 'deleted_at'),
    ('public', 'chat_participants', 'chat_id'),
    ('public', 'chat_participants', 'profile_id'),
    ('public', 'chat_clears', 'chat_id'),
    ('public', 'chat_clears', 'user_id'),
    ('public', 'chat_clears', 'cleared_at')
)
SELECT
  'required_columns' AS section,
  r.schema_name,
  r.table_name,
  r.column_name,
  a.attname IS NOT NULL AS present
FROM required r
LEFT JOIN pg_namespace n ON n.nspname = r.schema_name
LEFT JOIN pg_class c ON c.relnamespace = n.oid
  AND c.relname = r.table_name
  AND c.relkind IN ('r', 'p')
LEFT JOIN pg_attribute a ON a.attrelid = c.oid
  AND a.attname = r.column_name
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY r.table_name, r.column_name;

SELECT
  'table_security' AS section,
  c.relname,
  pg_get_userbyid(c.relowner) AS owner,
  c.relrowsecurity,
  c.relforcerowsecurity,
  current_user = pg_get_userbyid(c.relowner) AS current_user_is_owner,
  (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user) AS current_user_superuser,
  (
    current_user = pg_get_userbyid(c.relowner)
    OR COALESCE((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false)
  ) AS current_user_can_create_index,
  has_table_privilege(current_user, c.oid, 'SELECT') AS current_user_select,
  has_table_privilege(current_user, c.oid, 'DELETE') AS current_user_delete
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('messages', 'chats', 'chat_participants', 'chat_clears')
ORDER BY c.relname;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'functions' AS section,
  p.oid::regprocedure::text AS signature,
  p.proname,
  p.pronargs,
  pg_get_userbyid(p.proowner) AS owner,
  current_user AS migration_user,
  has_schema_privilege(current_user, 'public', 'USAGE') AS migration_user_public_usage,
  has_schema_privilege(current_user, 'public', 'CREATE') AS migration_user_public_create,
  (
    current_user = pg_get_userbyid(p.proowner)
    OR COALESCE((SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user), false)
  ) AS migration_user_is_owner_or_superuser,
  l.lanname AS language,
  p.prosecdef AS security_definer,
  p.provolatile AS volatility,
  p.proconfig AS proconfig,
  p.proacl AS proacl,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_language l ON l.oid = p.prolang
WHERE p.oid IN (SELECT oid FROM targets)
ORDER BY p.proname, p.oid, p.pronargs;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'acl' AS section,
  p.oid::regprocedure::text AS signature,
  pg_get_userbyid(p.proowner) AS owner,
  CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE acl.grantee::regrole::text END AS grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_proc p
CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
WHERE p.oid IN (SELECT oid FROM targets)
ORDER BY p.proname, grantee, acl.privilege_type;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'role_execute' AS section,
  p.oid::regprocedure::text AS signature,
  r.rolname,
  r.rolsuper,
  r.rolbypassrls,
  has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
CROSS JOIN pg_roles r
WHERE p.oid IN (SELECT oid FROM targets)
  AND (
    r.rolname IN ('anon', 'authenticated', 'service_role')
    OR (r.rolname !~ '^pg_' AND has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
  )
ORDER BY p.proname, r.rolname;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'dependencies' AS section,
  t.oid::regprocedure::text AS target_function,
  d.classid::regclass::text AS dependent_catalog,
  d.objid,
  d.objsubid,
  d.deptype,
  CASE d.classid
    WHEN 'pg_proc'::regclass THEN d.objid::regprocedure::text
    WHEN 'pg_rewrite'::regclass THEN (
      SELECT c.relnamespace::regnamespace::text || '.' || c.relname
      FROM pg_rewrite r
      JOIN pg_class c ON c.oid = r.ev_class
      WHERE r.oid = d.objid
    )
    WHEN 'pg_policy'::regclass THEN (
      SELECT pol.polrelid::regclass::text || '.' || pol.polname
      FROM pg_policy pol
      WHERE pol.oid = d.objid
    )
    WHEN 'pg_attrdef'::regclass THEN (
      SELECT a.adrelid::regclass::text || '.' || a.adnum::text
      FROM pg_attrdef a
      WHERE a.oid = d.objid
    )
    WHEN 'pg_constraint'::regclass THEN (
      SELECT c.conrelid::regclass::text || '.' || c.conname
      FROM pg_constraint c
      WHERE c.oid = d.objid
    )
    WHEN 'pg_trigger'::regclass THEN (
      SELECT tr.tgrelid::regclass::text || '.' || tr.tgname
      FROM pg_trigger tr
      WHERE tr.oid = d.objid
    )
    ELSE NULL
  END AS dependent_object
FROM pg_depend d
JOIN targets t ON d.refclassid = 'pg_proc'::regclass AND d.refobjid = t.oid
ORDER BY target_function, dependent_catalog, dependent_object;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'text_references' AS section,
  'function' AS object_type,
  n.nspname AS schema_name,
  p.proname AS object_name,
  p.oid::regprocedure::text AS detail
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.oid NOT IN (SELECT oid FROM targets)
  AND (
    p.prosrc ILIKE '%get_user_messages%'
    OR p.prosrc ILIKE '%purge_expired_ephemeral_messages%'
  )
UNION ALL
SELECT
  'text_references',
  'view',
  n.nspname,
  c.relname,
  pg_get_viewdef(c.oid)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v', 'm')
  AND (
    pg_get_viewdef(c.oid) ILIKE '%get_user_messages%'
    OR pg_get_viewdef(c.oid) ILIKE '%purge_expired_ephemeral_messages%'
  )
UNION ALL
SELECT
  'text_references',
  'policy',
  schemaname,
  tablename || '.' || policyname,
  COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
FROM pg_policies
WHERE COALESCE(qual, '') ILIKE '%get_user_messages%'
   OR COALESCE(with_check, '') ILIKE '%get_user_messages%'
   OR COALESCE(qual, '') ILIKE '%purge_expired_ephemeral_messages%'
   OR COALESCE(with_check, '') ILIKE '%purge_expired_ephemeral_messages%'
ORDER BY object_type, schema_name, object_name;

WITH targets AS (
  SELECT p.oid, pg_get_userbyid(p.proowner) AS owner
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'owner_capabilities' AS section,
  p.oid::regprocedure::text AS signature,
  t.owner,
  r.rolsuper AS owner_superuser,
  r.rolbypassrls AS owner_bypassrls,
  pg_get_userbyid(c.relowner) AS messages_owner,
  c.relrowsecurity AS messages_relrowsecurity,
  c.relforcerowsecurity AS messages_relforcerowsecurity,
  has_schema_privilege(t.owner, 'public', 'USAGE') AS public_usage,
  CASE
    WHEN to_regnamespace('auth') IS NULL THEN false
    ELSE has_schema_privilege(t.owner, 'auth', 'USAGE')
  END AS auth_usage,
  CASE
    WHEN to_regprocedure('auth.uid()') IS NULL THEN false
    ELSE has_function_privilege(t.owner, 'auth.uid()', 'EXECUTE')
  END AS auth_uid_execute,
  CASE
    WHEN to_regclass('public.messages') IS NULL THEN false
    ELSE has_table_privilege(t.owner, 'public.messages', 'SELECT')
  END AS messages_select,
  CASE
    WHEN to_regclass('public.messages') IS NULL THEN false
    ELSE has_table_privilege(t.owner, 'public.messages', 'DELETE')
  END AS messages_delete,
  CASE
    WHEN to_regclass('public.chats') IS NULL THEN false
    ELSE has_table_privilege(t.owner, 'public.chats', 'SELECT')
  END AS chats_select,
  CASE
    WHEN to_regclass('public.chat_participants') IS NULL THEN false
    ELSE has_table_privilege(t.owner, 'public.chat_participants', 'SELECT')
  END AS participants_select,
  CASE
    WHEN to_regclass('public.chat_clears') IS NULL THEN false
    ELSE has_table_privilege(t.owner, 'public.chat_clears', 'SELECT')
  END AS clears_select
FROM pg_proc p
JOIN targets t ON t.oid = p.oid
JOIN pg_roles r ON r.rolname = t.owner
LEFT JOIN pg_class c ON c.oid = to_regclass('public.messages')
ORDER BY p.proname;

WITH targets AS (
  SELECT p.oid
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('get_user_messages', 'purge_expired_ephemeral_messages')
)
SELECT
  'public_schema' AS section,
  n.nspname,
  pg_get_userbyid(n.nspowner) AS owner,
  n.nspacl,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
      THEN has_schema_privilege('anon', 'public', 'CREATE')
    ELSE false
  END AS anon_can_create,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
      THEN has_schema_privilege('authenticated', 'public', 'CREATE')
    ELSE false
  END AS authenticated_can_create,
  CASE
    WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')
      THEN has_schema_privilege('service_role', 'public', 'CREATE')
    ELSE false
  END AS service_role_can_create
FROM pg_namespace n
WHERE n.nspname = 'public'
  AND EXISTS (SELECT 1 FROM targets);

SELECT
  'post_migration' AS section,
  'NOTIFY pgrst, ''reload schema'';' AS command_after_applying_020;

ROLLBACK;
