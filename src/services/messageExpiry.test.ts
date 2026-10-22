import test from "node:test";
import assert from "node:assert/strict";

import {
  filterExpiredEphemeralMessages,
  isEphemeralMessageExpired,
} from "./messageExpiry";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

test("mensaje normal no se considera expirado", () => {
  assert.equal(
    isEphemeralMessageExpired({ isEphemeral: false, ephemeralExpiresAt: null }, NOW),
    false
  );
});

test("temporal con expiración futura sigue visible", () => {
  assert.equal(
    isEphemeralMessageExpired(
      { isEphemeral: true, ephemeralExpiresAt: "2026-01-01T00:00:01.000Z" },
      NOW
    ),
    false
  );
});

test("temporal con expiración vencida se oculta", () => {
  assert.equal(
    isEphemeralMessageExpired(
      { isEphemeral: true, ephemeralExpiresAt: "2025-12-31T23:59:59.000Z" },
      NOW
    ),
    true
  );
});

test("temporal sin fecha de expiración no se clasifica como expirado", () => {
  assert.equal(
    isEphemeralMessageExpired({ isEphemeral: true, ephemeralExpiresAt: null }, NOW),
    false
  );
});

test("fecha inválida no se clasifica como expirada", () => {
  assert.equal(
    isEphemeralMessageExpired(
      { isEphemeral: true, ephemeralExpiresAt: "not-a-date" },
      NOW
    ),
    false
  );
});

test("filtro conserva normales, futuros, nulos e inválidos y descarta vencidos", () => {
  const messages = [
    { id: "normal", isEphemeral: false },
    { id: "future", isEphemeral: true, ephemeralExpiresAt: "2026-01-01T00:00:01.000Z" },
    { id: "expired", isEphemeral: true, ephemeralExpiresAt: "2025-12-31T23:59:59.000Z" },
    { id: "null", isEphemeral: true, ephemeralExpiresAt: null },
    { id: "invalid", isEphemeral: true, ephemeralExpiresAt: "invalid" },
  ];
  assert.deepEqual(
    filterExpiredEphemeralMessages(messages, NOW).map((m) => m.id),
    ["normal", "future", "null", "invalid"]
  );
});
