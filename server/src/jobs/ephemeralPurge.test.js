import test from "node:test";
import assert from "node:assert/strict";

import {
  isExpiredEphemeralMessage,
  purgeExpiredEphemeralMessages,
  resolvePurgeIntervalMs,
  startEphemeralPurgeJob,
  stopEphemeralPurgeJob,
} from "./ephemeralPurge.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeClient({
  rpcError = null,
  rows = [],
  selectError = null,
  deleteError = null,
  deleteRows = null,
  onDelete = null,
} = {}) {
  const calls = { rpc: [], deleted: [], deletedIds: new Set(), selects: 0 };

  const client = {
    async rpc(name) {
      calls.rpc.push(name);
      if (rpcError) return { data: null, error: { message: rpcError } };
      return { data: 2, error: null };
    },
    from(table) {
      assert.equal(table, "messages");
      const query = {
        mode: "select",
        limitValue: null,
        ltValue: null,
        ids: null,
        select() {
          if (query.mode === "delete") {
            query.mode = "delete-select";
            return query;
          }
          calls.selects += 1;
          return query;
        },
        eq() {
          return query;
        },
        not() {
          return query;
        },
        lte(_column, value) {
          query.ltValue = value;
          return query;
        },
        limit(value) {
          query.limitValue = value;
          return query;
        },
        delete() {
          query.mode = "delete";
          return query;
        },
        in(_column, ids) {
          calls.deleted.push([...ids]);
          query.ids = [...ids];
          return query;
        },
        then(resolve, reject) {
          if (query.mode === "delete-select") {
            if (onDelete) onDelete(rows);
            const deleted = deleteRows ?? rows
              .filter((row) => query.ids.includes(row.id))
              .filter((row) => row.is_ephemeral === true)
              .filter((row) => row.ephemeral_expires_at)
              .filter((row) => Date.parse(row.ephemeral_expires_at) <= Date.parse(query.ltValue));
            deleted.forEach((row) => calls.deletedIds.add(row.id));
            return Promise.resolve({
              data: deleteError ? null : deleted.map((row) => ({ id: row.id })),
              error: deleteError ? { message: deleteError } : null,
            }).then(resolve, reject);
          }

          const filtered = rows
            .filter((row) => !calls.deletedIds.has(row.id))
            .filter((row) => row.is_ephemeral === true)
            .filter((row) => row.ephemeral_expires_at)
            .filter((row) => Date.parse(row.ephemeral_expires_at) <= Date.parse(query.ltValue));
          return Promise.resolve({
            data: selectError ? null : query.limitValue ? filtered.slice(0, query.limitValue) : filtered,
            error: selectError ? { message: selectError } : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };

  return { client, calls };
}

test("normal, futuro, nulo e inválido no se consideran expirados", () => {
  assert.equal(isExpiredEphemeralMessage({ is_ephemeral: false }, NOW.getTime()), false);
  assert.equal(
    isExpiredEphemeralMessage(
      { is_ephemeral: true, ephemeral_expires_at: "2026-01-01T00:00:01.000Z" },
      NOW.getTime()
    ),
    false
  );
  assert.equal(
    isExpiredEphemeralMessage(
      { is_ephemeral: true, ephemeral_expires_at: null },
      NOW.getTime()
    ),
    false
  );
  assert.equal(
    isExpiredEphemeralMessage(
      { is_ephemeral: true, ephemeral_expires_at: "invalid" },
      NOW.getTime()
    ),
    false
  );
});

test("pasado sí se considera expirado", () => {
  assert.equal(
    isExpiredEphemeralMessage(
      { is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
      NOW.getTime()
    ),
    true
  );
});

test("purga usa la RPC y no borra nada más si responde", async () => {
  const { client, calls } = makeClient();
  const result = await purgeExpiredEphemeralMessages(client, { now: NOW });
  assert.deepEqual(result, { purged: 2, fallback: false });
  assert.deepEqual(calls.rpc, ["purge_expired_ephemeral_messages"]);
  assert.equal(calls.deleted.length, 0);
});

test("fallback elimina únicamente temporales vencidos", async () => {
  const { client, calls } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "expired", is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
      { id: "future", is_ephemeral: true, ephemeral_expires_at: "2026-01-01T00:00:01.000Z" },
      { id: "normal", is_ephemeral: false, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
      { id: "no-date", is_ephemeral: true, ephemeral_expires_at: null },
    ],
  });
  const result = await purgeExpiredEphemeralMessages(client, { now: NOW });
  assert.deepEqual(result, { purged: 1, fallback: true });
  assert.deepEqual(calls.deleted, [["expired"]]);
});

test("limit inválido se rechaza antes de consultar la RPC", async () => {
  for (const limit of [0, -1, 1.5, "2", Number.NaN, Number.POSITIVE_INFINITY]) {
    const { client, calls } = makeClient();
    await assert.rejects(
      purgeExpiredEphemeralMessages(client, { now: NOW, limit }),
      /limit debe ser un entero positivo/
    );
    assert.deepEqual(calls.rpc, []);
  }
});

test("fallback revalida la expiración y no borra una fila extendida", async () => {
  const rows = [
    { id: "extended", is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
  ];
  const { client, calls } = makeClient({
    rpcError: "RPC no instalada",
    rows,
    onDelete: () => {
      rows[0].ephemeral_expires_at = "2026-01-01T00:00:01.000Z";
    },
  });
  await assert.rejects(
    purgeExpiredEphemeralMessages(client, { now: NOW }),
    /sin progreso/
  );
  assert.equal(calls.deletedIds.size, 0);
});

test("fallback sin filas eliminadas no entra en bucle", async () => {
  const { client, calls } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "expired", is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
    ],
    deleteRows: [],
  });
  await assert.rejects(
    purgeExpiredEphemeralMessages(client, { now: NOW }),
    /sin progreso/
  );
  assert.equal(calls.deleted.length, 1);
});

test("error del SELECT se propaga", async () => {
  const { client } = makeClient({
    rpcError: "RPC no instalada",
    selectError: "select boom",
  });
  await assert.rejects(
    purgeExpiredEphemeralMessages(client, { now: NOW }),
    (error) => error.message === "select boom"
  );
});

test("error del DELETE se propaga", async () => {
  const { client } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "expired", is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
    ],
    deleteError: "delete boom",
  });
  await assert.rejects(
    purgeExpiredEphemeralMessages(client, { now: NOW }),
    (error) => error.message === "delete boom"
  );
});

test("segunda ejecución del fallback es idempotente", async () => {
  const { client } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "expired", is_ephemeral: true, ephemeral_expires_at: "2025-12-31T23:59:59.000Z" },
    ],
  });
  assert.deepEqual(
    await purgeExpiredEphemeralMessages(client, { now: NOW }),
    { purged: 1, fallback: true }
  );
  assert.deepEqual(
    await purgeExpiredEphemeralMessages(client, { now: NOW }),
    { purged: 0, fallback: true }
  );
});

test("fallback no llama delete si no hay vencidos", async () => {
  const { client, calls } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "future", is_ephemeral: true, ephemeral_expires_at: "2026-01-01T00:00:01.000Z" },
    ],
  });
  const result = await purgeExpiredEphemeralMessages(client, { now: NOW });
  assert.deepEqual(result, { purged: 0, fallback: true });
  assert.equal(calls.deleted.length, 0);
});

test("fallback procesa varios lotes de vencidos", async () => {
  const { client, calls } = makeClient({
    rpcError: "RPC no instalada",
    rows: [
      { id: "a", is_ephemeral: true, ephemeral_expires_at: "2025-12-30T00:00:00.000Z" },
      { id: "b", is_ephemeral: true, ephemeral_expires_at: "2025-12-30T00:00:00.000Z" },
      { id: "c", is_ephemeral: true, ephemeral_expires_at: "2025-12-30T00:00:00.000Z" },
    ],
  });
  const result = await purgeExpiredEphemeralMessages(client, { now: NOW, limit: 2 });
  assert.deepEqual(result, { purged: 3, fallback: true });
  assert.equal(calls.deleted.length, 2);
  assert.equal(calls.deletedIds.size, 3);
});

test("intervalo inválido cae al valor por defecto y el job no se duplica", () => {
  assert.equal(resolvePurgeIntervalMs("0"), 60 * 60 * 1000);
  assert.equal(resolvePurgeIntervalMs("invalid"), 60 * 60 * 1000);
  assert.equal(resolvePurgeIntervalMs("120000"), 120000);

  const { client } = makeClient();
  const logger = { info() {}, error() {} };
  const first = startEphemeralPurgeJob(client, { intervalMs: 60000, logger });
  const second = startEphemeralPurgeJob(client, { intervalMs: 60000, logger });
  assert.equal(first, second);
  stopEphemeralPurgeJob();
  stopEphemeralPurgeJob();
  const third = startEphemeralPurgeJob(client, { intervalMs: 60000, logger });
  assert.notEqual(third, first);
  stopEphemeralPurgeJob();
});
