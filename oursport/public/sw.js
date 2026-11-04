// Minimal service worker for web push (Pillar 4). Only handles push display and
// notification clicks; it intentionally does not cache/intercept fetches, so it
// won't conflict with anything Expo's own web build may add later.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Our Sport", body: event.data.text() };
  }
  const title = payload.title || "Our Sport";
  const options = {
    body: payload.body || "",
    data: payload,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length > 0) {
        return clients[0].focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
