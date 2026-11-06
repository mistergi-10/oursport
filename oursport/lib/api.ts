import { API_BASE_URL } from "./constants";
import i18n from "./i18n";
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
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Thrown by authRequest (signup/login/password-reset), mirroring ApiError's
// shape so describeApiError can translate either one the same way.
export class AuthError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
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
    const errorPayload = payload as { error?: string; code?: string } | null;
    throw new ApiError(
      response.status,
      errorPayload?.error ?? `API request failed: ${response.status}`,
      errorPayload?.code,
    );
  }
  return (await response.json()) as T;
}

// Translates a caught ApiError/AuthError's stable `code` into the active
// locale's string, falling back to `errors.generic` for an unrecognized code
// (e.g. one added server-side after this client shipped) or to the caller's
// own fallback for errors that never carried a code (e.g. a network failure).
export function describeApiError(caught: unknown, fallback: string) {
  const code = caught instanceof ApiError ? caught.code : caught instanceof AuthError ? caught.code : undefined;
  if (code) return i18n.t(`errors.${code}`, { defaultValue: i18n.t("errors.generic") });
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
    const errorPayload = payload as { error?: string; code?: string } | null;
    throw new AuthError(errorPayload?.error ?? "Request failed", errorPayload?.code);
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

