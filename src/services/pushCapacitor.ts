import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { authFetch } from '../lib/api';
import { playSound } from './soundService';
import { logger } from '../lib/logger';

const isNative = Capacitor.isNativePlatform();

function getServerUrl(): string | null {
  return import.meta.env.VITE_SERVER_URL || null;
}

const PUSH_TOKEN_KEY = 'redon_push_token';
let lastRegisteredUserId: string | null = null;
let lastRegisteredToken: string | null = null;

async function registerTokenWithServer(token: string, userId: string, attempt = 1): Promise<void> {
  const baseUrl = getServerUrl();
  if (!baseUrl) return;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await authFetch(`${baseUrl}/api/fcm/register`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: userId, token, device: 'android-fcm' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      lastRegisteredUserId = userId;
      lastRegisteredToken = token;
    } else if (attempt < 3) {
      await new Promise(r => setTimeout(r, 3000 * attempt));
      return registerTokenWithServer(token, userId, attempt + 1);
    }
} catch (e) {
      logger.warn("[PushCapacitor] registerTokenWithServer failed", { error: e, attempt });
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        return registerTokenWithServer(token, userId, attempt + 1);
      }
    }
}

export async function setupCapacitorPush(userId: string) {
  if (!isNative) return;

try {
      try {
        await PushNotifications.createChannel({
          id: 'redon-messages',
          name: 'Mensajes',
          importance: 5,
          visibility: 1,
          sound: 'notificacion',
          vibration: true,
          lights: true,
        });
        await PushNotifications.createChannel({
          id: 'redon-calls',
          name: 'Llamadas',
          importance: 5,
          visibility: 1,
          sound: 'ringtone',
          vibration: true,
          lights: true,
        });
      } catch (e) {
        logger.warn("[PushCapacitor] createChannel failed", { error: e });
      }

      const permStatus = await PushNotifications.requestPermissions();
      if (permStatus.receive !== 'granted') return;

      const registrationPromise = new Promise<string>((resolve) => {
        const regListener = PushNotifications.addListener('registration', (token: any) => {
          const pushToken = token.value;
          try { localStorage.setItem(PUSH_TOKEN_KEY, pushToken); } catch (e) {
            logger.warn("[PushCapacitor] localStorage.setItem failed", { error: e });
          }
          registerTokenWithServer(pushToken, userId);
          resolve(pushToken);
        });

        const errListener = PushNotifications.addListener('registrationError', () => {});
      });

      await PushNotifications.register();

      const token = await Promise.race([
        registrationPromise,
        new Promise<string>((resolve) => setTimeout(() => resolve(''), 10000))
      ]);

      if (!token) {
        try {
          const savedToken = localStorage.getItem(PUSH_TOKEN_KEY);
          if (savedToken && savedToken !== lastRegisteredToken) {
            registerTokenWithServer(savedToken, userId);
          }
        } catch (e) {
          logger.warn("[PushCapacitor] fallback token load failed", { error: e });
        }
      }

      PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
        const data = notification.data;
        logger.info('[PUSH] pushNotificationReceived', { data });
        if (data?.type === 'call_dismissed' && data?.callId) {
          logger.info('[PUSH] Dispatching call_dismissed CustomEvent');
          window.dispatchEvent(new CustomEvent('call_dismissed', {
            detail: { callId: data.callId, chatId: data.chatId || '', callerId: data.callerId || '' },
          }));
        } else if (data?.type === 'call' && data?.chatId) {
          logger.info('[PUSH] Dispatching incoming-call CustomEvent from FCM');
          // NO reproducir el tono aquí: el handler incoming-call de la app lo
          // reproduce con guardas de "llamada activa" (evita que un push duplicado
          // vuelva a sonar después de que ya se contestó). El sonido nativo lo
          // pone CallFcmService/IncomingCallActivity.
          window.dispatchEvent(new CustomEvent('incoming-call', {
            detail: { chatId: data.chatId, callerId: data.callerId, callerName: data.callerName, callType: data.callType || 'audio', callId: data.callId },
          }));
          // Notification with buttons is handled by CallFcmService.java natively
        } else if (data?.type === 'message' && data?.chatId) {
          // We keep the native notification from CallFcmService (which has Quick Reply)
          // No need to duplicate here - just dispatch the event for in-app UI
          window.dispatchEvent(new CustomEvent('new-message-received', {
            detail: {
              chatId: data.chatId,
              contactId: data.contactId,
              title: data.title,
              body: data.body,
              fileUrl: data.fileUrl,
              documentName: data.documentName,
              mimeType: data.mimeType,
              msgType: data.msgType,
            },
          }));
        } else if (data?.type === 'group_added' && data?.chatId) {
          // Notificación al ser agregado a un grupo, con sonido para avisar
          try { playSound("message", 0.7); } catch (e) {
            logger.warn("[PushCapacitor] playSound message failed", { error: e });
          }
          window.dispatchEvent(new CustomEvent('group-added', {
            detail: { chatId: data.chatId, title: data.title, body: data.body },
          }));
        }
      });

      PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
        const data = action.notification.data;
        if (!data) return;
        if (data.type === 'call' && data.chatId) {
          window.dispatchEvent(new CustomEvent('incoming-call', {
            detail: { chatId: data.chatId, callerId: data.callerId, callerName: data.callerName || 'Llamada entrante', callType: data.callType || 'audio', callId: data.callId },
          }));
        } else if (data.chatId) {
          window.dispatchEvent(new CustomEvent('open-chat', {
            detail: {
              chatId: data.chatId,
              contactId: data.contactId,
              title: data.title,
              body: data.body,
              fileUrl: data.fileUrl,
              documentName: data.documentName,
              mimeType: data.mimeType,
              msgType: data.msgType,
            },
          }));
        }
      });
    } catch (e) {
      logger.error("[PushCapacitor] setupCapacitorPush failed", { error: e });
    }
}

export async function sendFcmPush(profileId: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  const baseUrl = getServerUrl();
  if (!baseUrl) return false;
  try {
    const res = await authFetch(`${baseUrl}/api/fcm/send`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId, title, body, data }),
    });
    if (!res.ok) {
      logger.error('[PUSH] Error sending push', { status: res.status, error: await res.text().catch(() => '') });
      return false;
    }
    const result = await res.json();
    const totalSent = result.sent || result.android || result.web || 0;
    if (totalSent === 0) {
      logger.error('[PUSH] No push tokens found or send failed', { result });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('[PUSH] sendFcmPush exception', { error: err });
    return false;
  }
}

export async function unregisterCapacitorPush() {
  if (!isNative) return;
  try {
    await PushNotifications.unregister();
  } catch (e) {
    logger.warn("[PushCapacitor] unregister failed", { error: e });
  }
}
