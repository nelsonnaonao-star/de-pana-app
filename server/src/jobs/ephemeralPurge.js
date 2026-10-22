const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const FALLBACK_LIMIT = 200;
const MAX_FALLBACK_BATCHES = 1000;

let timer = null;
let inFlight = false;

export function isExpiredEphemeralMessage(message, nowMs = Date.now()) {
  if (!message || message.is_ephemeral !== true || !message.ephemeral_expires_at) {
    return false;
  }
  const expiresAtMs = Date.parse(message.ephemeral_expires_at);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
}

export function resolvePurgeIntervalMs(raw = process.env.EPHEMERAL_PURGE_INTERVAL_MS) {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_INTERVAL_MS) {
    return DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

function assertFallbackLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit debe ser un entero positivo');
  }
}

export async function purgeExpiredEphemeralMessages(
  supabaseAdmin,
  { now = new Date(), limit = FALLBACK_LIMIT } = {}
) {
  assertFallbackLimit(limit);

  const { data, error } = await supabaseAdmin.rpc('purge_expired_ephemeral_messages');

  if (!error) {
    return { purged: Number(data) || 0, fallback: false };
  }

  let purged = 0;

  for (let batch = 0; batch < MAX_FALLBACK_BATCHES; batch += 1) {
    const { data: rows, error: selectError } = await supabaseAdmin
      .from('messages')
      .select('id, is_ephemeral, ephemeral_expires_at')
      .eq('is_ephemeral', true)
      .not('ephemeral_expires_at', 'is', null)
      .lte('ephemeral_expires_at', now.toISOString())
      .limit(limit);

    if (selectError) throw selectError;

    const ids = (rows || [])
      .filter((row) => isExpiredEphemeralMessage(row, now.getTime()))
      .map((row) => row.id);

    if (ids.length === 0) return { purged, fallback: true };

    const { data: deletedRows, error: deleteError } = await supabaseAdmin
      .from('messages')
      .delete()
      .eq('is_ephemeral', true)
      .not('ephemeral_expires_at', 'is', null)
      .lte('ephemeral_expires_at', now.toISOString())
      .in('id', ids)
      .select('id');

    if (deleteError) throw deleteError;

    const deletedCount = Array.isArray(deletedRows) ? deletedRows.length : 0;
    if (deletedCount === 0) {
      throw new Error('Purga fallback sin progreso: el DELETE no eliminó filas');
    }

    purged += deletedCount;
    if (deletedCount < ids.length) continue;
    if (ids.length < limit) return { purged, fallback: true };
  }

  throw new Error(`Purga fallback superó el máximo de ${MAX_FALLBACK_BATCHES} lotes`);
}

export function startEphemeralPurgeJob(
  supabaseAdmin,
  { intervalMs = resolvePurgeIntervalMs(), logger = console } = {}
) {
  if (timer) return timer;

  const run = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await purgeExpiredEphemeralMessages(supabaseAdmin);
      if (result.purged > 0) {
        logger.info(`[EPHEMERAL-PURGE] ${result.purged} mensaje(s) eliminado(s)${result.fallback ? ' (fallback)' : ''}`);
      }
    } catch (error) {
      logger.error('[EPHEMERAL-PURGE] error:', error?.message || error);
    } finally {
      inFlight = false;
    }
  };

  void run();
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(`[EPHEMERAL-PURGE] activo cada ${intervalMs} ms`);
  return timer;
}

export function stopEphemeralPurgeJob() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
