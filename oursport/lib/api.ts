import { API_BASE_URL } from "./constants";
import type { Auth } from "./types";

export function createUserId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, auth: Auth, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      // Only a non-empty body gets a JSON content-type; Fastify rejects an empty
      // body sent with "content-type: application/json" (join/leave event, unblock).
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...(auth.userId ? { "x-user-id": auth.userId } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = (payload as { error?: string } | null)?.error;
    throw new ApiError(response.status, message ?? `API request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// Shared message for the newly rate-limited mutation routes (swipe, send message,
// create/join/leave event, block, report, delete account).
export function describeApiError(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.status === 429) return "Zu viele Anfragen, bitte kurz warten.";
  return fallback;
}

export async function authRequest<T>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new Error(message ?? "Anfrage fehlgeschlagen");
  }
  return payload as T;
}

// Browser/RN WebSocket handshakes can't set an Authorization header, so the
// token (Bearer JWT, or the dev X-User-Id) travels as a `?token=` query param
// instead, mirroring the server's /v1/ws auth. Returns null if signed out.
export function getWebSocketUrl(path: string, auth: Auth) {
  const token = auth.token ?? auth.userId;
  if (!token) return null;
  const wsBaseUrl = API_BASE_URL.replace(/^http/, "ws");
  return `${wsBaseUrl}${path}?token=${encodeURIComponent(token)}`;
}

