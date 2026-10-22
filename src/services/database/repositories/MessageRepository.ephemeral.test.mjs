import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mock } from "node:test";

const CHAT = "chat-1";
const NOW_FUTURE = "2999-01-01T00:00:00.000Z";
const NOW_PAST = "2000-01-01T00:00:00.000Z";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    chat_id TEXT,
    raw_created_at TEXT,
    payload TEXT
  )
`);

let executeSetCalls = 0;

const db = {
  ready: true,
  async query(sql, params) {
    return sqlite.prepare(sql).all(...params);
  },
  async executeSet() {
    executeSetCalls += 1;
  },
  async run() {},
};

mock.module("../../messages", { exports: { editMessage: async () => {} } });
mock.module("../DatabaseService", { exports: { db } });
mock.module("../../storageService", {
  exports: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    getKeys: async () => [],
  },
});

const { MessageRepository } = await import("./MessageRepository.ts");

const insert = sqlite.prepare(
  "INSERT INTO messages (id, chat_id, raw_created_at, payload) VALUES (?, ?, ?, ?)"
);

for (const message of [
  {
    id: "normal",
    sender: "other",
    timestamp: "2026-01-01T00:00:00.000Z",
    rawCreatedAt: "2026-01-01T00:00:00.000Z",
    type: "text",
    isEphemeral: false,
  },
  {
    id: "future",
    sender: "other",
    timestamp: "2026-01-01T00:00:01.000Z",
    rawCreatedAt: "2026-01-01T00:00:01.000Z",
    type: "text",
    isEphemeral: true,
    ephemeralExpiresAt: NOW_FUTURE,
  },
  {
    id: "expired",
    sender: "other",
    timestamp: "2026-01-01T00:00:02.000Z",
    rawCreatedAt: "2026-01-01T00:00:02.000Z",
    type: "text",
    isEphemeral: true,
    ephemeralExpiresAt: NOW_PAST,
  },
]) {
  insert.run(message.id, CHAT, message.rawCreatedAt, JSON.stringify(message));
}

test("getMessages descarta temporales vencidos leídos desde SQLite", async () => {
  const repo = new MessageRepository();
  const messages = await repo.getMessages(CHAT);
  assert.deepEqual(
    messages.map((message) => message.id),
    ["normal", "future"]
  );
});

test("upsertMessage no persiste un temporal ya vencido", async () => {
  const repo = new MessageRepository();
  executeSetCalls = 0;
  await repo.upsertMessage(CHAT, {
    id: "expired-upsert",
    sender: "other",
    timestamp: "2026-01-01T00:00:03.000Z",
    type: "text",
    isEphemeral: true,
    ephemeralExpiresAt: NOW_PAST,
  });
  assert.equal(executeSetCalls, 0);
});
