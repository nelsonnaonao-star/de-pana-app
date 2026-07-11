import { apiUrl, authFetch } from "../lib/api";

async function registerTokenWithServer(token: string, userId: string, attempt = 1): Promise<void> {
  const serverUrl = import.meta.env.VITE_SERVER_URL;
  if (!serverUrl) return;
  try {
    const res = await authFetch(`${serverUrl}/api/fcm/register`, {
      method: 'POST',
      body: JSON.stringify({ profile_id: userId, token, device: 'android-fcm' }),
    });
    if (!res.ok && attempt < 3) {
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

export async function registerPushNotifications(userId: string): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (!("serviceWorker" in navigator)) return false;

  const VAPID_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
  if (!VAPID_PUBLIC_KEY) return false;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return false;

    const existing = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const registration = existing || await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const res = await authFetch(apiUrl("/api/fcm/register"), {
      method: "POST",
      body: JSON.stringify({
        profile_id: userId,
        token: JSON.stringify(subscription),
        device: "web-push",
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
    if (registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      await registration.unregister();
    }
  } catch {}
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
