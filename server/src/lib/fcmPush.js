import { getMessaging } from 'firebase-admin/messaging';
import { supabaseAdmin } from '../db.js';

const ANDROID_DEVICES = new Set(['android-fcm', 'android']);

export function isAndroidDevice(device) {
  return ANDROID_DEVICES.has(device);
}

// Firebase Admin rechaza el mensaje COMPLETO si algún valor de `data` no es
// string (undefined/null son los casos típicos). Un solo campo opcional vacío
// hacía fallar el push para TODOS los tokens. Aquí se normaliza a string y se
// descartan los campos ausentes.
export function sanitizeFcmData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      out[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = String(value);
    } else {
      try {
        out[key] = JSON.stringify(value);
      } catch {
        // Valor no serializable: se omite.
      }
    }
  }
  return out;
}

function dedupeTokens(tokens) {
  const seen = new Set();
  const unique = [];
  for (const t of tokens || []) {
    if (!t?.token || seen.has(t.token)) continue;
    seen.add(t.token);
    unique.push(t);
  }
  return unique;
}

function isDeadTokenError(err) {
  const code = err?.code || '';
  if (code === 'messaging/registration-token-not-registered') return true;
  if (code === 'messaging/invalid-registration-token') return true;
  if (code === 'messaging/invalid-argument' && /registration token/i.test(String(err?.message || ''))) {
    return true;
  }
  return false;
}

// Envía a todos los tokens en paralelo (con límite) y borra de push_tokens los
// que FCM reporta como inválidos. Un token muerto ya no vuelve a costar tiempo
// ni a bloquear al token vigente del dispositivo.
export async function sendAndroidPush(tokens, buildMessage, { concurrency = 20 } = {}) {
  const unique = dedupeTokens(tokens);
  const stats = { sent: 0, failed: 0, invalid: 0 };

  if (!unique.length) return stats;

  let messaging;
  try {
    messaging = getMessaging();
  } catch (err) {
    console.error('[FCM] Firebase Messaging no disponible:', err?.message || err);
    stats.failed = unique.length;
    return stats;
  }

  const deadTokens = [];
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= unique.length) return;
      const t = unique[index];
      try {
        const message = buildMessage(t.token, t);
        await messaging.send(message);
        stats.sent++;
      } catch (err) {
        stats.failed++;
        if (isDeadTokenError(err)) {
          deadTokens.push(t.token);
        } else {
          console.error('[FCM] send error:', err?.code || err?.message || err);
        }
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, unique.length) },
    () => worker()
  );
  await Promise.allSettled(workers);

  if (deadTokens.length) {
    stats.invalid = deadTokens.length;
    try {
      for (let i = 0; i < deadTokens.length; i += 50) {
        await supabaseAdmin
          .from('push_tokens')
          .delete()
          .in('token', deadTokens.slice(i, i + 50));
      }
      console.log(`[FCM] Tokens inválidos eliminados: ${deadTokens.length}`);
    } catch (err) {
      console.error('[FCM] No se pudieron eliminar tokens inválidos:', err?.message || err);
    }
  }

  return stats;
}
