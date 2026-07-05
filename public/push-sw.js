self.addEventListener("push", (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || "RED ON";
    const body = data.body || "";
    const icon = data.icon || "/vite.svg";
    const badge = data.badge || "/vite.svg";
    const tag = data.data?.chatId || "redon-message";

    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        badge,
        tag,
        data: data.data || {},
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: data.data?.type === "call"
          ? [{ action: "answer", title: "Responder" }, { action: "decline", title: "Rechazar" }]
          : [{ action: "open", title: "Abrir chat" }],
      })
    );
  } catch (e) {
    console.error("[SW] Push parse error:", e);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  if (event.action === "decline") return;

  const url = data.chatId
    ? `/?chatId=${data.chatId}`
    : "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.postMessage({ type: "open-chat", chatId: data.chatId });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
