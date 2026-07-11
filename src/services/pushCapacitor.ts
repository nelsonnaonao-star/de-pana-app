import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { authFetch } from '../lib/api';

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
  } catch {
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
    } catch {}

    const permStatus = await PushNotifications.requestPermissions();
    if (permStatus.receive !== 'granted') return;

    const registrationPromise = new Promise<string>((resolve) => {
      const regListener = PushNotifications.addListener('registration', (token: any) => {
        const pushToken = token.value;
        try { localStorage.setItem(PUSH_TOKEN_KEY, pushToken); } catch {}
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
      } catch {}
    }

    PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
      const data = notification.data;
      if (data?.type === 'call' && data?.chatId) {
        window.dispatchEvent(new CustomEvent('incoming-call', {
          detail: { chatId: data.chatId, callerId: data.callerId, callerName: data.callerName, callType: data.callType || 'audio' },
        }));
      } else if (data?.type === 'message' && data?.chatId) {
        window.dispatchEvent(new CustomEvent('new-message-received', {
          detail: { chatId: data.chatId, contactId: data.contactId, title: data.title, body: data.body },
        }));
      }
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action: any) => {
      const data = action.notification.data;
      if (!data) return;
      if (data.type === 'call' && data.chatId) {
        window.dispatchEvent(new CustomEvent('incoming-call', {
          detail: { chatId: data.chatId, callerId: data.callerId, callerName: data.callerName || 'Llamada entrante', callType: data.callType || 'audio' },
        }));
      } else if (data.chatId) {
        window.dispatchEvent(new CustomEvent('open-chat', {
          detail: { chatId: data.chatId, contactId: data.contactId, title: data.title, body: data.body },
        }));
      }
    });
  } catch {}
}

export async function sendFcmPush(profileId: string, title: string, body: string, data?: Record<string, string>) {
  const baseUrl = getServerUrl();
  if (!baseUrl) return;
  try {
    const res = await authFetch(`${baseUrl}/api/fcm/send`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: profileId, title, body, data }),
    });
  } catch {}
}

export async function unregisterCapacitorPush() {
  if (!isNative) return;
  try {
    await PushNotifications.unregister();
  } catch {}
}
