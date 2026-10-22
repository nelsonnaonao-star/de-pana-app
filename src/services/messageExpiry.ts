export type EphemeralExpiryFields = {
  isEphemeral?: boolean | null;
  ephemeralExpiresAt?: string | null;
};

export function isEphemeralMessageExpired(
  message: EphemeralExpiryFields,
  nowMs = Date.now()
): boolean {
  if (!message?.isEphemeral || !message.ephemeralExpiresAt) return false;
  const expiresAtMs = Date.parse(message.ephemeralExpiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export function filterExpiredEphemeralMessages<T extends EphemeralExpiryFields>(
  messages: T[],
  nowMs = Date.now()
): T[] {
  return messages.filter((message) => !isEphemeralMessageExpired(message, nowMs));
}
