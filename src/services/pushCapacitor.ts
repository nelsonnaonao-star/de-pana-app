import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

const isNative = Capacitor.isNativePlatform();

function getServerUrl(): string | null {
  return import.meta.env.VITE_SERVER_URL || null;
}

const PUSH_TOKEN_KEY = 'redon_push_token';
let lastRegisteredUserId: string | null = null;
let lastRegisteredToken: string | null = null;

async function registerTokenWithServer(token: string, userId: string, attempt = 1): Promise<void> {
  const baseUrl = getServerUrl();
  if (!baseUrl) { console.warn('[FCM] no server URL'); return; }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`${baseUrl}/api/fcm/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: userId, token, device: 'android-fcm' }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      console.log('[FCM] Token registered OK');
      lastRegisteredUserId = userId;
      lastRegisteredToken = token;
    } else {
      console.warn('[FCM] Register failed:', res.status, await res.text().catch(() => ''));
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 3000 * attempt));
        return registerTokenWithServer(token, userId, attempt + 1);
      }
    }
  } catch (err: any) {
    console.warn('[FCM] Register error:', err?.message || err);
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 3000 * attempt));
      return registerTokenWithServer(token, userId, attempt + 1);
    }
  }
}

export async function setupCapacitorPush(userId: string) {
  console.log('[FCM] setupCapacitorPush called, isNative:', isNative);
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
      console.log('[FCM] Notification channels created');
    } catch (e) {
      console.warn('[FCM] Channel creation error:', e);
    }

    const permStatus = await PushNotifications.requestPermissions();
    console.log('[FCM] Permissions:', JSON.stringify(permStatus));
    if (permStatus.receive !== 'granted') {
      console.warn('[FCM] Permission not granted');
      return;
    }

    // Register listener BEFORE calling register() to avoid race condition
    const registrationPromise = new Promise<string>((resolve) => {
      const regListener = PushNotifications.addListener('registration', (token: any) => {
        console.log('[FCM] Registration token received:', token.value?.substring(0, 30) + '...');
        const pushToken = token.value;
        try { localStorage.setItem(PUSH_TOKEN_KEY, pushToken); } catch {}
        registerTokenWithServer(pushToken, userId);
        resolve(pushToken);
      });

      const errListener = PushNotifications.addListener('registrationError', (err: any) => {
        console.error('[FCM] Registration error:', err);
      });
    });

    await PushNotifications.register();
    console.log('[FCM] PushNotifications.register() called');

    // Wait a bit for the token, then proceed
    const token = await Promise.race([
      registrationPromise,
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 10000))
    ]);

    if (!token) {
      console.warn('[FCM] No token received in 10s, trying saved token');
    }

    // Also try re-registering with any saved token as backup
    try {
      const savedToken = localStorage.getItem(PUSH_TOKEN_KEY);
      if (savedToken && savedToken !== lastRegisteredToken) {
        console.log('[FCM] Re-registering saved token');
        registerTokenWithServer(savedToken, userId);
      }
    } catch {}

    PushNotifications.addListener('pushNotificationReceived', (notification: any) => {
      console.log('[FCM] ═══════ PUSH RECEIVED ═══════');
      console.log('[FCM] notification keys:', Object.keys(notification).join(','));
      console.log('[FCM] data:', JSON.stringify(notification.data));
      console.log('[FCM] data.type:', notification.data?.type);
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
      console.log('[FCM] ═══════ ACTION PERFORMED ═══════');
      console.log('[FCM] action:', JSON.stringify(action));
      const data = action.notification.data;
      console.log('[FCM] action data:', JSON.stringify(data));
      if (!data) {
        console.log('[FCM] ❌ no data in action');
        return;
      }
      if (data.type === 'call' && data.chatId) {
        console.log('[FCM] -> dispatching incoming-call');
        window.dispatchEvent(new CustomEvent('incoming-call', {
          detail: { chatId: data.chatId, callerId: data.callerId, callerName: data.callerName || 'Llamada entrante', callType: data.callType || 'audio' },
        }));
      } else if (data.chatId) {
        console.log('[FCM] -> dispatching open-chat with chatId:', data.chatId, 'contactId:', data.contactId);
        window.dispatchEvent(new CustomEvent('open-chat', {
          detail: { chatId: data.chatId, contactId: data.contactId, title: data.title, body: data.body },
        }));
      }
    });
  } catch (e) {
    console.error('[FCM] setupCapacitorPush failed:', e);
  }
}

export async function sendFcmPush(profileId: string, title: string, body: string, data?: Record<string, string>) {
  const baseUrl = getServerUrl();
  if (!baseUrl) { console.warn('[FCM] no server URL'); return; }
  try {
    const res = await fetch(`${baseUrl}/api/fcm/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId, title, body, data }),
    });
    if (!res.ok) console.warn('[FCM] send failed:', res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.warn('[FCM] send error:', err);
  }
}

export async function unregisterCapacitorPush() {
  if (!isNative) return;
  try {
    await PushNotifications.unregister();
  } catch {}
}
