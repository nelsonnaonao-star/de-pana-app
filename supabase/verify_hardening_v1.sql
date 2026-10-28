-- ============================================================
-- VERIFICACIÓN POST-MIGRACIÓN — WEPA SECURITY HARDENING v1
-- Ejecutar en: Supabase Dashboard → SQL Editor → Run
--
-- Este script NO modifica nada. Solo verifica y reporta.
-- Copia el resultado y pégamelo para que yo analice.
-- ============================================================

-- ─── 1. TRIGGERS ────────────────────────────────────────────
SELECT '=== TRIGGERS ===' as section;

SELECT
  trigger_name,
  event_manipulation as evento,
  event_object_table as tabla,
  action_timing as timing,
  CASE
    WHEN action_statement LIKE '%messages_guard_sensitive_fields%' THEN '✅ messages_guard'
    WHEN action_statement LIKE '%calls_guard_sensitive_fields%' THEN '✅ calls_guard'
    ELSE '❌ WRONG TRIGGER: ' || action_statement
  END as status
FROM information_schema.triggers
WHERE trigger_name = 'guard_sensitive_fields'
ORDER BY event_object_table;

-- Conteo esperado: 2 triggers (messages + calls)
SELECT
  CASE
    WHEN COUNT(*) = 2 THEN '✅ TRIGGERS: 2 encontrados (messages + calls)'
    ELSE '❌ TRIGGERS: ' || COUNT(*) || ' encontrados (esperados 2)'
  END as resultado
FROM information_schema.triggers
WHERE trigger_name = 'guard_sensitive_fields';


-- ─── 2. FUNCIONES RPC ──────────────────────────────────────
SELECT '=== FUNCIONES ===' as section;

-- user_in_chat
SELECT
  routine_name,
  security_type,
  CASE
    WHEN routine_definition LIKE '%auth.uid()%' THEN '✅ Usa auth.uid()'
    WHEN routine_definition LIKE '%user_uuid%' AND routine_definition NOT LIKE '%auth.uid()%' THEN '❌ USA user_uuid parameter (INSEGURO)'
    ELSE '⚠️ Verificar manualmente'
  END as auth_check,
  LEFT(routine_definition, 200) as preview
FROM information_schema.routines
WHERE routine_name IN ('user_in_chat', 'is_chat_member')
  AND routine_schema = 'public'
ORDER BY routine_name;

-- Conteo esperado: 2 funciones
SELECT
  CASE
    WHEN COUNT(*) = 2 THEN '✅ FUNCTIONS: 2 encontradas'
    ELSE '❌ FUNCTIONS: ' || COUNT(*) || ' encontradas (esperadas 2)'
  END as resultado
FROM information_schema.routines
WHERE routine_name IN ('user_in_chat', 'is_chat_member')
  AND routine_schema = 'public';


-- ─── 3. GRANTS ─────────────────────────────────────────────
SELECT '=== GRANTS ===' as section;

-- Verificar que anon NO tiene EXECUTE en las funciones
SELECT
  grantee,
  routine_name,
  privilege_type,
  CASE
    WHEN grantee = 'anon' THEN '❌ ANON TIENE ACCESO (debería ser revocado)'
    WHEN grantee = 'authenticated' THEN '✅ Solo authenticated tiene acceso'
    ELSE '⚠️ Otro grantee: ' || grantee
  END as status
FROM information_schema.role_routines
WHERE routine_name IN ('user_in_chat', 'is_chat_member')
  AND routine_schema = 'public'
ORDER BY routine_name, grantee;


-- ─── 3b. GRANTS: funciones de mantenimiento RPC (T-5) ──────
-- Refleja la ACL EFECTIVA en la BD (has_function_privilege), no las
-- declaraciones presentes en los archivos .sql.
SELECT
  p.proname AS funcion,
  r.rolname AS rol,
  has_function_privilege(r.oid, p.oid, 'EXECUTE') AS puede_ejecutar,
  CASE
    WHEN r.rolname = 'anon'          AND has_function_privilege(r.oid, p.oid, 'EXECUTE') THEN '❌ anon NO debe poder ejecutar'
    WHEN r.rolname = 'authenticated' AND has_function_privilege(r.oid, p.oid, 'EXECUTE') THEN '❌ authenticated NO debe poder ejecutar'
    WHEN r.rolname = 'service_role'  AND NOT has_function_privilege(r.oid, p.oid, 'EXECUTE') THEN '❌ service_role debe poder ejecutar (backend)'
    WHEN r.rolname = 'service_role'  THEN '✅ service_role puede ejecutar'
    ELSE '✅ sin acceso'
  END AS status
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'service_role')
WHERE n.nspname = 'public'
  AND p.proname IN ('cleanup_old_chat_unread_pings', 'purge_expired_ephemeral_messages')
ORDER BY p.proname, r.rolname;


-- ─── 4. RLS POLICIES EN messages ───────────────────────────
SELECT '=== POLICIES messages ===' as section;

SELECT
  policyname,
  cmd as operacion,
  qual as using_check,
  with_check
FROM pg_policies
WHERE tablename = 'messages'
  AND schemaname = 'public'
ORDER BY cmd, policyname;


-- ─── 5. RLS POLICIES EN calls ─────────────────────────────
SELECT '=== POLICIES calls ===' as section;

SELECT
  policyname,
  cmd as operacion,
  qual as using_check,
  with_check
FROM pg_policies
WHERE tablename = 'calls'
  AND schemaname = 'public'
ORDER BY cmd, policyname;


-- ─── 6. VERIFICACIÓN DE TRIGGER FUNCTION BODY ─────────────
SELECT '=== TRIGGER FUNCTION BODY ===' as section;

SELECT
  routine_name,
  LEFT(routine_definition, 500) as definition_preview
FROM information_schema.routines
WHERE routine_name IN ('messages_guard_sensitive_fields', 'calls_guard_sensitive_fields')
  AND routine_schema = 'public'
ORDER BY routine_name;


-- ─── 7. RESUMEN ───────────────────────────────────────────
SELECT '=== RESUMEN ===' as section;

SELECT 'Triggers' as item,
  (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name = 'guard_sensitive_fields') as encontrados,
  2 as esperados,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name = 'guard_sensitive_fields') = 2
    THEN '✅' ELSE '❌' END as status
UNION ALL
SELECT 'Functions',
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name IN ('user_in_chat', 'is_chat_member') AND routine_schema = 'public'),
  2,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name IN ('user_in_chat', 'is_chat_member') AND routine_schema = 'public') = 2
    THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'Anon grants',
  (SELECT COUNT(*) FROM information_schema.role_routines WHERE routine_name IN ('user_in_chat', 'is_chat_member') AND grantee = 'anon'),
  0,
  CASE WHEN (SELECT COUNT(*) FROM information_schema.role_routines WHERE routine_name IN ('user_in_chat', 'is_chat_member') AND grantee = 'anon') = 0
    THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'Anon grants (mantenimiento)',
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('cleanup_old_chat_unread_pings', 'purge_expired_ephemeral_messages')
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public', p.oid, 'EXECUTE'))),
  0,
  CASE WHEN (SELECT COUNT(*) FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.proname IN ('cleanup_old_chat_unread_pings', 'purge_expired_ephemeral_messages')
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('public', p.oid, 'EXECUTE'))) = 0
    THEN '✅' ELSE '❌' END
UNION ALL
SELECT 'service_role grants (mantenimiento)',
  (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('cleanup_old_chat_unread_pings', 'purge_expired_ephemeral_messages')
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')),
  2,
  CASE WHEN (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('cleanup_old_chat_unread_pings', 'purge_expired_ephemeral_messages')
       AND has_function_privilege('service_role', p.oid, 'EXECUTE')) = 2
    THEN '✅' ELSE '❌' END;
