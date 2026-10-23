# Slice 1: Production identity provider — hardening

## Summary

Email/password signup and login already exist and issue 30-day JWTs (`server/src/index.ts`, `server/src/auth.ts`, `server/src/passwords.ts`). This slice does **not** add a new identity provider; it closes the gaps that keep the existing custom email/password provider from being production-ready: a profile-mutation bug for JWT-authenticated users, no brute-force protection on auth endpoints, and no account-recovery path.

## Current state (verified in code)

- `POST /v1/auth/signup` and `POST /v1/auth/login` exist, validate with Zod, hash passwords with `scrypt` + per-user salt + timing-safe compare (`server/src/passwords.ts`), and return a JWT via `issueToken()` ([server/src/index.ts](../../server/src/index.ts#L47)).
- `issueToken()` signs an HS256 JWT with a fixed 30-day expiry and no refresh mechanism ([server/src/auth.ts](../../server/src/auth.ts#L8)).
- `authenticate()` accepts a Bearer JWT in any environment, and additionally accepts an `X-User-Id` dev bridge header only when `NODE_ENV !== "production"` ([server/src/auth.ts](../../server/src/auth.ts#L20)).
- `GET /v1/me` resolves the DB user row from the JWT's `authSubject` via `resolveUserId()`, but `POST /v1/profiles` and `PATCH /v1/me` read `identity.userId` directly, which is **only ever set by the dev `X-User-Id` header**, never by Bearer-JWT auth ([server/src/index.ts](../../server/src/index.ts#L108) and [server/src/index.ts](../../server/src/index.ts#L145)). Any password-authenticated user calling these in production gets `409 "... requires a development user id"`.
- `oursport/App.tsx` has working Login/Signup screens that call the two auth endpoints, store the token/profile in `AsyncStorage`, and clear them on logout or on a failed `/v1/me` refresh. The "Mit Google/Apple fortfahren" buttons are non-functional placeholders (`SocialAuthButtons`, shows an alert).
- There is no password reset, no rate limiting on auth endpoints, no email verification, and no server-side mechanism to invalidate a previously issued JWT.

## Decision

Email/password is the chosen production identity provider (already built). This slice hardens it rather than adding Google/Apple OAuth, which would require external provider setup and native config beyond the current placeholder buttons. Social login stays a future slice.

## User stories

1. As a signed-up user, I can edit my profile after logging in with email/password, without the request being rejected.
2. As a user who forgot my password, I can request a reset code by email and set a new password without contacting support.
3. As the platform, repeated signup/login/reset attempts from the same source are throttled so credential stuffing and account enumeration are impractical.
4. As a user who just reset my password, any previously issued token for my account stops working.

## Data model changes

`server/src/db/schema.ts`:

- Add `tokenVersion: integer("token_version").default(0).notNull()` to `users`. Bumped on password reset; included as a JWT claim and checked on every authenticated request.
- New table `passwordResetCodes`:
  - `id: uuid` primary key, default random
  - `userId: uuid` references `users.id`, `onDelete: "cascade"`
  - `codeHash: text` not null — SHA-256 hash of the 6-digit code, never store the raw code
  - `expiresAt: timestamp (withTimezone)` not null — issued-at + 15 minutes
  - `usedAt: timestamp (withTimezone)` nullable
  - `createdAt: timestamp (withTimezone)` default now, not null
  - index on `userId`

Requires a new Drizzle migration (`npm run db:generate` / `db:migrate` per existing convention); no destructive changes to existing columns.

## API contract

All new/changed routes live in `server/src/index.ts` and keep the existing Zod-validation + stateless-API conventions.

### Changed: `POST /v1/profiles`, `PATCH /v1/me`

- Resolve the acting user the same way `GET /v1/me` already does: via `resolveUserId(subject, userId)` (authSubject lookup, falling back to the dev `X-User-Id` only outside production), instead of requiring `identity.userId` directly.
- Response/request shapes are unchanged.
- Fixes the 409 regression for JWT-authenticated (password) users.

### New: `POST /v1/auth/password-reset/request`

- Body: `{ email: string }` (reuses existing email validation from `credentialsSchema`).
- Behavior: always responds `202 { status: "ok" }`, whether or not the email exists (no account enumeration). If the email matches a user, invalidate any unused codes for that user, create one `passwordResetCodes` row with a random 6-digit code, email it via the transactional email provider (see open question).
- Outside production (`NODE_ENV !== "production"`), the response additionally includes `resetCode` for local testing, mirroring the existing dev-bridge convention — never included in production.
- Rate limited: 5 requests / 15 minutes per IP+email pair.

### New: `POST /v1/auth/password-reset/confirm`

- Body: `{ email: string, code: string (6 digits), newPassword: string (min 8, max 200) }`.
- Behavior: look up the latest unused, unexpired code for that email's user; if missing/expired/mismatched, respond `400 { error: "Invalid or expired code" }`. On success: set the new `passwordHash`, mark the code `usedAt`, increment `users.tokenVersion` (invalidates all previously issued JWTs), respond `200 { status: "ok" }`. Client must log in again afterward (no auto-issued token).
- Rate limited: 10 requests / 15 minutes per IP.

### Changed: JWT issuance and verification

- `issueToken(subject, tokenVersion)` embeds `tokenVersion` as a custom claim.
- `authenticate()` keeps verifying the Bearer signature/expiry as today, then the caller (`resolveUserId`) additionally compares the JWT's `tokenVersion` claim against the current DB value for that user; mismatch → `401`.

### Changed: rate limiting

- Add `@fastify/rate-limit`, applied per-route:
  - `POST /v1/auth/signup`: 5 / 10 min per IP.
  - `POST /v1/auth/login`: 10 / 10 min per IP+email.
  - `POST /v1/auth/password-reset/*`: per above.
- Exceeding the limit returns `429 { error: "Too many requests" }`.

## Mobile UI/UX notes (`oursport/App.tsx`)

- `LoginScreen`: add a "Passwort vergessen?" link navigating to a new `ForgotPasswordScreen`.
- New `ForgotPasswordScreen`: email input → calls `password-reset/request` → shows a "check your email for a code" confirmation, with a button to continue to `ResetPasswordScreen`.
- New `ResetPasswordScreen`: email (prefilled), 6-digit code input, new password input → calls `password-reset/confirm` → on success, navigates back to `LoginScreen` with a success message; on `400`, shows an inline error and allows retry.
- On any `401` from an authenticated call (now also triggered by a stale `tokenVersion` after a reset), keep the existing behavior in the bootstrap effect: clear `oursport-token`/`oursport-profile` and fall back to the `Welcome`/`Login` flow.
- No changes to `SocialAuthButtons` (still placeholders) or to `ProfileScreen`'s settings rows (profile editing UI itself is out of scope here — only the API bug blocking it is fixed).

## Acceptance criteria

1. A user who signed up and logged in with email/password can successfully call `POST /v1/profiles` and `PATCH /v1/me` with only a Bearer JWT (no `X-User-Id` header) and receive `201`/`200`, not `409`.
2. `POST /v1/auth/password-reset/request` with a registered email returns `202` and creates exactly one new, unused `passwordResetCodes` row; with an unregistered email it also returns `202` and creates no row.
3. `POST /v1/auth/password-reset/confirm` with a valid, unexpired code updates `passwordHash`, marks the code used, and increments `tokenVersion`.
4. A JWT issued before a password reset is rejected (`401`) on any authenticated endpoint after the reset completes; a freshly issued token (from a new login) is accepted.
5. A reset code is rejected after 15 minutes from issuance, or if already used, or if it does not match the latest issued code for that user.
6. `POST /v1/auth/login` returns `429` after exceeding the configured attempt threshold for the same IP+email within the window, and recovers after the window elapses.
7. `POST /v1/auth/signup` returns `429` after exceeding the configured attempt threshold for the same IP within the window.
8. In production (`NODE_ENV=production`), `password-reset/request` responses never include the raw code; outside production they do.
9. Existing signup/login behavior (schema validation, duplicate-email `409`, invalid-credentials `401`) is unchanged.
10. Mobile app can complete the full forgot-password → enter code → new password → login round trip against the local dev API.

## Out of scope

- Google/Apple OAuth (social buttons stay placeholders).
- Email verification at signup.
- Short-lived access tokens with a separate refresh-token flow (JWT expiry stays 30 days).
- Multi-device/session listing or "log out of all devices" UI (the `tokenVersion` bump is an automatic side effect of a password reset only).
- Changing password while logged in without a reset code (a settings-screen "change password" form); this can reuse the same `confirm` mutation logic in a later slice.
- Any transactional email template design beyond a plain-text code message.

## Open questions

1. **Email delivery provider**: no transactional email provider or `EMAIL_FROM`/API-key env var exists yet. Needs a human decision (e.g. Resend, SendGrid, Postmark, SES) before `password-reset/request` can send real emails in production; local/non-prod testing can proceed using the `resetCode` field in the response without this decision.
2. Is a 30-day JWT expiry acceptable for production, or should a future slice add shorter-lived access tokens + refresh tokens? Flagged but deliberately deferred here.
3. Should `POST /v1/auth/login` rate-limit failures count only failed attempts, or all attempts (including successful ones) toward the same bucket? Affects false-positive risk for shared-IP users (e.g. NAT/office networks).
