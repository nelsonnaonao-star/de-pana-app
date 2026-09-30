/**
 * Marcador de lectura por (usuario, chat).
 *
 * El contador de no leídos NO es un acumulador: es un valor DERIVADO de este
 * marcador. Un mismo mensaje que llega por tres canales (Realtime de `chats`,
 * `chat_unread_pings` y push FCM) produce SIEMPRE el mismo resultado porque
 * los tres caminos ejecutan el mismo recálculo sobre el mismo estado.
 *
 * Persistencia: localStorage, clave por usuario (`redon_lastread_<userId>`), de
 * modo que (userA, chat123) y (userB, chat123) son estados independientes y
 * cerrar/reabrir la app conserva el valor.
 *
 * NO toca SCHEMA_SQL, DB_VERSION, DatabaseService ni SyncService.
 */

import { logger } from "../lib/logger";

const STORAGE_PREFIX = "redon_lastread_";

export interface ReadMarker {
  /** id del último mensaje marcado como leído (autoritativo). */
  messageId: string;
  /** ISO del último mensaje marcado como leído (frontera de lectura). */
  at: string;
  /**
   * Timestamps ISO de mensajes entrantes detectados por evento que aún no
   * existen en la caché local. Cubre la ventana entre "llegó el evento" y "el
   * mensaje se persistió", para que el contador no caiga a 0 por un instante.
   * Se poda solo cuando el mensaje aparece en la caché.
   */
  pending: string[];
}

type MarkerMap = Record<string, ReadMarker>;

function keyFor(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readMap(userId: string): MarkerMap {
  if (!userId) return {};
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as MarkerMap;
  } catch (e) {
    logger.warn("[UNREAD] marker read failed", { error: e });
    return {};
  }
}

function writeMap(userId: string, map: MarkerMap): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(map));
  } catch (e) {
    logger.warn("[UNREAD] marker write failed", { error: e });
  }
}

function normalize(marker: ReadMarker | undefined | null): ReadMarker {
  return {
    messageId: typeof marker?.messageId === "string" ? marker.messageId : "",
    at: typeof marker?.at === "string" ? marker.at : "",
    pending: Array.isArray(marker?.pending)
      ? marker.pending.filter((p) => typeof p === "string")
      : [],
  };
}

function toMs(ts: string | undefined | null): number {
  if (!ts) return NaN;
  const ms = new Date(ts).getTime();
  return ms;
}

export function getReadMarker(userId: string, chatId: string): ReadMarker {
  return normalize(readMap(userId)[chatId]);
}

/**
 * Marca el chat como leído moviendo la frontera al último mensaje disponible.
 * Es la única fuente de verdad del reset a 0 (no un simple `unreadCount = 0`).
 */
export function setReadMarker(
  userId: string,
  chatId: string,
  messageId?: string,
  at?: string,
): void {
  if (!userId || !chatId) return;
  const map = readMap(userId);
  map[chatId] = {
    messageId: messageId || "",
    at: at || new Date().toISOString(),
    pending: [],
  };
  writeMap(userId, map);
}

/**
 * Registra la llegada de un mensaje entrante. Idempotente: si el mismo
 * timestamp ya está en `pending` no lo vuelve a agregar, de modo que realtime,
 * ping de grupo y FCM Notification del mismo mensaje no se cuenten tres veces.
 */
export function registerIncoming(userId: string, chatId: string, at?: string): void {
  if (!userId || !chatId) return;
  const ms = toMs(at);
  if (Number.isNaN(ms)) return; // sin timestamp no hay identidad fiable
  const iso = new Date(ms).toISOString();

  const map = readMap(userId);
  const marker = normalize(map[chatId]);

  // Ya cubierto por la frontera de lectura: no cuenta.
  if (marker.at && iso <= marker.at) return;
  if (marker.pending.includes(iso)) return;

  marker.pending = [...marker.pending, iso];
  // Tope de seguridad: el pendiente nunca debe crecer sin límite.
  if (marker.pending.length > 200) {
    marker.pending = marker.pending.slice(marker.pending.length - 200);
  }
  map[chatId] = marker;
  writeMap(userId, map);
}

export interface UnreadMessageLike {
  id: string;
  sender?: string;
  rawCreatedAt?: string;
  timestamp?: string;
}

/**
 * Cálculo determinista del no leído de un chat. NUNCA suma.
 *
 * unread = mensajes locales ajenos posteriores a la frontera
 *        + pendientes por evento aún no presentes en la caché
 *
 * Un mensaje presente a la vez en la caché y en `pending` se cuenta UNA sola
 * vez: el pendiente se poda cuando su timestamp aparece entre los locales.
 */
export function computeUnread(
  userId: string,
  chatId: string,
  localMessages: UnreadMessageLike[],
): number {
  const marker = getReadMarker(userId, chatId);
  const boundaryMs = toMs(marker.at);
  const hasBoundary = !Number.isNaN(boundaryMs);

  const localAfter = new Set<string>();
  for (const m of localMessages) {
    if (m.sender === "me") continue; // lo propio nunca es no leído
    const ts = m.rawCreatedAt || m.timestamp;
    const ms = toMs(ts);
    if (Number.isNaN(ms)) continue;
    if (hasBoundary && ms <= boundaryMs) continue;
    localAfter.add(new Date(ms).toISOString());
  }

  // `pending[]` NO alimenta el valor numérico del contador.
  //
  // El servidor emite un timestamp distinto por canal para el MISMO mensaje
  // (messages.created_at, chats.last_message_time, chat_unread_pings.sent_at y
  // FCM data.ts se generan con llamadas independientes a new Date()). Por eso
  // un pendiente de evento nunca coincide exactamente con el raw_created_at
  // del mensaje ya persistido, y sumarlos contaba el mismo mensaje 2 o 3
  // veces. El contador se deriva EXCLUSIVAMENTE de los mensajes locales.
  const total = localAfter.size;

  // Poda de `pending[]` (no altera el contador): los pendientes cuyos
  // timestamps ya aparecen entre los mensajes locales son redundantes.
  if (marker.pending.some((iso) => localAfter.has(iso))) {
    const map = readMap(userId);
    const current = normalize(map[chatId]);
    if (current.pending.length > 0) {
      map[chatId] = { ...current, pending: current.pending.filter((iso) => !localAfter.has(iso)) };
      writeMap(userId, map);
    }
  }

  return total;
}

/** Borra el marcador de un chat (borrar mensajes / expulsado). */
export function clearReadMarker(userId: string, chatId: string): void {
  if (!userId || !chatId) return;
  const map = readMap(userId);
  if (!(chatId in map)) return;
  delete map[chatId];
  writeMap(userId, map);
}
