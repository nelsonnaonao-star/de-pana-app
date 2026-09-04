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
    THEN '✅' ELSE '❌' END;
