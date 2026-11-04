import webpush from "web-push";
import { eq } from "drizzle-orm";

import { getDatabase } from "./db/client.js";
import { pushSubscriptions } from "./db/schema.js";

let vapidConfigured = false;

// VAPID_* env vars won't exist in dev/CI (and may not exist on Render yet
// either), so this resolves once and lets every send silently no-op until set.
function ensureVapidConfigured() {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

// Best-effort fan-out to every subscription a user has (multiple browsers/tabs).
// Never throws: unconfigured VAPID keys, an expired subscription, or a network
// error are all caught/logged here so callers can fire this after their own
// transaction commits without risking the triggering request.
export async function sendWebPushToUser(userId: string, payload: Record<string, unknown>) {
  try {
    if (!ensureVapidConfigured()) return;

    const database = getDatabase();
    const subscriptions = await database
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId));
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dhKey, auth: subscription.authKey },
            },
            body,
          );
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            // Subscription no longer valid on the push service's end; remove it
            // so future sends stop retrying a dead endpoint.
            await database.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
          } else {
            console.warn(`web-push send failed for subscription ${subscription.id}:`, error);
          }
        }
      }),
    );
  } catch (error) {
    console.warn(`web-push send failed for user ${userId}:`, error);
  }
}
