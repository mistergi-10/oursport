import { Platform } from "react-native";

import { apiRequest } from "./api";
import i18n from "./i18n";
import type { Auth } from "./types";

export function isPushSupported() {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

// Converts the server's base64url-encoded VAPID key into the Uint8Array shape
// PushManager.subscribe's applicationServerKey expects.
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
}

// Reuses whatever service worker already controls the page (e.g. one Expo's own
// web build output registers) instead of adding a second one; only registers
// ours as a fallback if none exists yet.
async function getServiceWorkerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

export async function getExistingPushSubscription() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function enablePushNotifications(auth: Auth) {
  if (!isPushSupported()) {
    throw new Error(i18n.t("errors.push_unsupported"));
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(i18n.t("errors.push_permission_denied"));
  }

  const { publicKey } = await apiRequest<{ publicKey: string | null }>("/v1/push/public-key", auth);
  if (!publicKey) {
    throw new Error(i18n.t("errors.push_not_configured"));
  }

  const registration = await getServiceWorkerRegistration();
  await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error(i18n.t("errors.push_subscription_failed"));
  }

  await apiRequest("/v1/push/subscribe", auth, {
    method: "POST",
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    }),
  });
}

export async function disablePushNotifications(auth: Auth) {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => undefined);
  await apiRequest("/v1/push/unsubscribe", auth, {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}
