import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../../migrations/020_fix_ephemeral_messages_lifecycle.sql", import.meta.url),
  "utf8"
);
const preflight = readFileSync(
  new URL("../../../supabase/preflight_020_ephemeral_messages.sql", import.meta.url),
  "utf8"
);

const getMessagesBody = migration.match(
  /CREATE OR REPLACE FUNCTION public\.get_user_messages[\s\S]*?AS \$\$([\s\S]*?)\$\$;/
)?.[1];

test("migración revoca la purga a PUBLIC, anon y authenticated", () => {
  assert.match(
    migration,
    /REVOKE EXECUTE ON FUNCTION public\.purge_expired_ephemeral_messages\(\)\s+FROM PUBLIC, anon, authenticated;/i
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.purge_expired_ephemeral_messages\(\) TO service_role;/i
  );
  assert.doesNotMatch(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.purge_expired_ephemeral_messages\(\) TO (anon|authenticated|PUBLIC)/i
  );
});

test("ambas funciones usan un search_path seguro", () => {
  assert.equal(
    (migration.match(/SET search_path = pg_catalog/g) || []).length,
    2
  );
  assert.doesNotMatch(migration, /SET search_path = public/);
});

test("get_user_messages autoriza con auth.uid y no usa user_uuid", () => {
  assert.ok(getMessagesBody);
  assert.match(getMessagesBody, /auth\.uid\(\)/);
  assert.doesNotMatch(getMessagesBody, /user_uuid/);
  assert.match(getMessagesBody, /ephemeral_expires_at > now\(\)/);
});

test("get_user_messages acota p_limit entre 0 y 200", () => {
  assert.ok(getMessagesBody);
  assert.match(
    getMessagesBody,
    /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 200\), 0\), 200\)/i
  );
  assert.doesNotMatch(getMessagesBody, /LIMIT\s+p_limit\b/i);
});

test("la eliminación de sobrecargas es explícita y sin CASCADE", () => {
  assert.match(
    migration,
    /format\('public\.%I\(%s\)', p\.proname, pg_get_function_identity_arguments\(p\.oid\)\)/
  );
  assert.match(migration, /DROP FUNCTION IF EXISTS/);
  assert.doesNotMatch(migration, /DROP FUNCTION[\s\S]*?CASCADE/i);
});

test("la purga verifica el propietario sin cambiarlo ni conceder privilegios", () => {
  assert.match(
    migration,
    /to_regprocedure\('public\.purge_expired_ephemeral_messages\(\)'\)/
  );
  assert.match(
    migration,
    /has_table_privilege\(v_owner, 'public\.messages', 'SELECT'\)/
  );
  assert.match(
    migration,
    /has_table_privilege\(v_owner, 'public\.messages', 'DELETE'\)/
  );
  assert.match(migration, /RAISE EXCEPTION/);
  assert.doesNotMatch(migration, /ALTER FUNCTION[\s\S]*OWNER TO/i);
  assert.match(preflight, /owner_capabilities/);
  assert.match(preflight, /messages_delete/);
});

test("el preflight es de solo lectura y cubre dependencias, ACL y recarga", () => {
  assert.match(preflight, /^BEGIN TRANSACTION READ ONLY;/);
  assert.match(preflight, /ROLLBACK;\s*$/);
  assert.match(preflight, /pg_depend/);
  assert.match(preflight, /aclexplode/);
  assert.match(preflight, /has_schema_privilege/);
  assert.match(preflight, /reload schema/);
});
