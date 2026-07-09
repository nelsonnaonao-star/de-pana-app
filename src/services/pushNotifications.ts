import { apiUrl } from "../lib/api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";
let registeredUserId: string | null = null;

export async function registerPushNotifications(userId: string): Promise<boolean> {
  if (!("Notification" in window)) {
    console.log("[PUSH] Notifications not supported");
    return false;
  }
  if (!("serviceWorker" in navigator)) {
    console.log("[PUSH] Service workers not supported");
    return false;
  }
  if (!VAPID_PUBLIC_KEY) {
    console.warn("[PUSH] VAPID public key not configured");
    return false;
  }
  if (registeredUserId === userId) {
    return true;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[PUSH] Permission denied");
      return false;
    }

    const existing = await navigator.serviceWorker.getRegistration("/push-sw.js");
    const registration = existing || await navigator.serviceWorker.register("/push-sw.js", {
      scope: "/",
    });
    registeredUserId = userId;
    console.log("[PUSH] Service worker registered");

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const res = await fetch(apiUrl("/api/fcm/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile_id: userId,
        token: JSON.stringify(subscription),
        device: "web-push",
      }),
    });

    if (!res.ok) {
      console.warn("[PUSH] Failed to register with server");
      return false;
    }

    console.log("[PUSH] Registered successfully");
    return true;
  } catch (e) {
    console.error("[PUSH] Error:", e);
    return false;
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
    if (registration) {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
      await registration.unregister();
    }
  } catch (e) {
    console.warn("[PUSH] Unregister error:", e);
  }
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
