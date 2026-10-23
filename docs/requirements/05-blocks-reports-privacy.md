# Slice 5: Blocks, reports, rate limits, and privacy/data deletion

## Summary

Let a user block another user (disappears from discover, can't swipe/match/message each other again, existing conversation goes inactive for both sides) and report a user for manual review; add `@fastify/rate-limit` to the authenticated mutation routes that currently have none; and add a self-service "delete my account" flow that requires password confirmation, invalidates the account immediately, and anonymizes personal data rather than destructively cascading deletes through other users' matches/conversations/events.

## Current state (verified in code)

- `server/src/db/schema.ts` has `users`, `profiles`, `password_reset_codes`, `swipes`, `matches`, `conversations`, `messages`, `events`, `event_members`. There is no block, report, or soft-delete column.
- `server/src/index.ts` registers `@fastify/rate-limit` globally-disabled (`global: false`) at [server/src/index.ts](../../server/src/index.ts#L91), and only the `/v1/auth/*` routes opt in via a per-route `config: { rateLimit: { max, timeWindow } }` (plus a custom `ipAndEmailKey` key generator for login/password-reset at [server/src/index.ts](../../server/src/index.ts#L96)). None of `POST /v1/swipes` ([server/src/index.ts](../../server/src/index.ts#L477)), `POST /v1/conversations/:conversationId/messages` ([server/src/index.ts](../../server/src/index.ts#L769)), `POST /v1/events` ([server/src/index.ts](../../server/src/index.ts#L792)), or `POST/leave /v1/events/:eventId/join|leave` have any rate-limit config.
- `GET /v1/discover` ([server/src/index.ts](../../server/src/index.ts#L396)) excludes only already-swiped and already-matched candidates — no block check. `POST /v1/swipes` ([server/src/index.ts](../../server/src/index.ts#L477)) looks up the target's profile with no block check. `GET /v1/matches` ([server/src/index.ts](../../server/src/index.ts#L563)) and `GET /v1/conversations` ([server/src/index.ts](../../server/src/index.ts#L624)) list every match/conversation the caller is part of with no block filter. `findConversationForParticipant` ([server/src/index.ts](../../server/src/index.ts#L1025)) already returns `null` uniformly for "doesn't exist" and "caller isn't a participant" so callers can 404 without leaking which — this is the pattern to extend for "blocked" as a third indistinguishable-404 reason.
- `users` ([server/src/db/schema.ts](../../server/src/db/schema.ts#L13)) has `tokenVersion`, already bumped on password reset ([server/src/index.ts](../../server/src/index.ts#L296)) to immediately invalidate outstanding JWTs; `resolveUserId` ([server/src/index.ts](../../server/src/index.ts#L999)) rejects a request whose JWT `tokenVersion` no longer matches the stored one. Every content table (`profiles`, `swipes`, `matches`, `messages`, `events`, `event_members`) has `onDelete: "cascade"` back to `users.id`, so a hard `DELETE FROM users` would cascade-destroy *other users'* shared data too (e.g. deleting a match's `userLowId`/`userHighId` row cascades the `conversations` row, which cascades every `messages` row in it — including messages written by the other, non-deleted participant; deleting an event's `creatorUserId` cascades the whole `events` row and every other attendee's `event_members` row). This is why account deletion in this slice anonymizes in place instead of deleting the `users` row.
- `authenticate` ([server/src/auth.ts](../../server/src/auth.ts#L19)) accepts either a verified Bearer JWT (production path) or, outside production, a raw `X-User-Id` dev header with no password at all — relevant to the password-confirmation requirement on account deletion (see open question 4).
- `oursport/App.tsx`'s `ProfileScreen` ([oursport/App.tsx](../../oursport/App.tsx#L1839)) already renders a static, non-interactive "Daten & DSGVO" settings row ([oursport/App.tsx](../../oursport/App.tsx#L1876)) alongside a working `Abmelden` (logout) row — this is the natural existing hook for the new privacy/delete-account screen. `RootStackParamList` ([oursport/App.tsx](../../oursport/App.tsx#L86)) has no block/report/privacy screen entries yet.

## User stories

1. As a user, I can block another user from their profile, a discover card, or a conversation, so I stop seeing them in discover and stop sending/receiving messages with them.
2. As a user, once I've blocked someone, neither of us can swipe-match with the other again, and our conversation (if any) stops showing up and stops accepting new messages for both of us.
3. As a user, I can see who I've blocked and unblock them if I change my mind.
4. As a user, I can report another user with a reason (and an optional note) so the behavior can be reviewed later, without that report taking any automatic action against the reported user.
5. As a user, if I spam swipes, messages, or event actions, the API slows me down instead of accepting unlimited requests.
6. As a user, I can permanently delete my account (after confirming my password) and know my personal data (name, bio, photos-to-be, birth date, location, email, password) is scrubbed, even though the deletion doesn't retroactively break conversations or events other people are still part of.

## Data model changes

`server/src/db/schema.ts` — two new tables, one new column:

```ts
export const blocks = pgTable(
  "blocks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    blockerUserId: uuid("blocker_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("blocks_blocker_blocked_unique").on(table.blockerUserId, table.blockedUserId),
    index("blocks_blocked_idx").on(table.blockedUserId),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: uuid("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 30 }).notNull(), // "spam" | "harassment" | "fake_profile" | "inappropriate_content" | "other"
    note: varchar("note", { length: 1000 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("reports_reported_idx").on(table.reportedUserId)],
);
```

```ts
// add to the existing `users` table:
deletedAt: timestamp("deleted_at", { withTimezone: true }),
```

- `blocks` is directional (`blockerUserId` → `blockedUserId`) but every read-path check in this slice treats it as symmetric: "is there a `blocks` row with `(blocker, blocked)` equal to `(A, B)` *or* `(B, A)`?" — one insert from either side fully blocks interaction between the pair. The unique index makes blocking idempotent; it does not store "which side blocked first" semantics beyond that.
- `reports` has no status/outcome column in this slice — a row is just a durable, queryable record for manual review (e.g. direct DB/admin-tool access later). No foreign key back from `reports` to `messages`/`swipes`/etc.; the optional free-text `note` is how a reporter points at specific content.
- `users.deletedAt` marks an account as deleted. Deletion does **not** delete the `users` row (see "Current state" above for why) — it nulls out `email`/`passwordHash`, tombstones `authSubject`, bumps `tokenVersion`, sets `deletedAt`, and overwrites the linked `profiles` row's personal fields with anonymized placeholders, while leaving `swipes`/`matches`/`conversations`/`messages`/`events`/`event_members` rows intact so other users' history isn't destroyed.
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only — no changes to existing column types/constraints.

## API contract

All routes require the existing Bearer-JWT / dev `X-User-Id` auth and resolve the acting user via `resolveUserId`, unless noted. All new mutation routes get a per-route `config: { rateLimit: {...} }` using the existing `@fastify/rate-limit` registration — see the "Rate limiting" subsection for the full list including slice 1–4 routes.

A shared helper, e.g. `async function isBlocked(database, userIdA, userIdB)`, should back every check below: `exists (blockerUserId=A AND blockedUserId=B) OR (blockerUserId=B AND blockedUserId=A)`.

### New: `POST /v1/blocks`

- Body: `{ "userId": "uuid" }` (the user to block).
- `400` if `userId === caller`. `404` if `userId` doesn't correspond to an existing user (mirrors the `POST /v1/swipes` target-profile check).
- Behavior: inserts `(blockerUserId: caller, blockedUserId: userId)` with `onConflictDoNothing()` (idempotent — blocking twice is a no-op, not an error).
- Response `201`: `{ "blocked": true, "userId": "uuid" }`.

### New: `DELETE /v1/blocks/:userId`

- Path param: `userId` (uuid) — only removes a block the caller placed (`blockerUserId = caller`); cannot be used to lift a block the *other* person placed on the caller.
- Behavior: deletes the matching `blocks` row if present. Idempotent — `200` whether or not a row existed.
- Response `200`: `{ "unblocked": true, "userId": "uuid" }`.
- Unblocking has no DB side effects beyond deleting the row: any still-existing match/conversation/messages become reachable again immediately (see open question 2).

### New: `GET /v1/blocks`

- No query params (list is expected to stay small; no pagination in this slice).
- Response `200`: `{ "blocked": [ { "userId": "uuid", "name": "string" } ] }` — only blocks the caller placed (`blockerUserId = caller`), `LEFT JOIN profiles` so a since-deleted blocked account still renders (fallback `name: "Gelöschtes Konto"` when the profile has been anonymized or is otherwise missing).

### New: `POST /v1/reports`

- Body: `{ "userId": "uuid", "reason": "spam" | "harassment" | "fake_profile" | "inappropriate_content" | "other", "note": "string, trimmed, 0-1000 chars, optional" }`.
- `400` if `userId === caller`. `404` if `userId` doesn't correspond to an existing user.
- Behavior: inserts a `reports` row. No automatic consequence for the reported user (no auto-block, no auto-hide) — reporting and blocking are independent actions; the client may offer both in the same UI action sheet but calls both endpoints separately if the user opts into both.
- Response `201`: `{ "reported": true }`.

### New: `DELETE /v1/me`

- Body: `{ "password": "string" }` — required when the caller's `users.passwordHash` is set (i.e. every production, password-auth account). When `passwordHash` is null (only possible via the non-production `X-User-Id` dev bridge, which has no password), the `password` field is ignored and the confirmation step is skipped — see open question 4.
- `401` if a `password` was required and didn't match (reuses `verifyPassword`/`DUMMY_PASSWORD_HASH` from `server/src/passwords.ts`, same timing-safe pattern as `POST /v1/auth/login`).
- Behavior, in one transaction:
  - `users`: set `email = null`, `passwordHash = null`, `authSubject = 'deleted:' + users.id`, `tokenVersion = tokenVersion + 1`, `deletedAt = now()`.
  - `profiles`: overwrite `displayName` (e.g. `"Gelöschtes Konto"`), `bio = null`, `birthDate = null`, `latitude = null`, `longitude = null`; `city`/`sport`/`level` are also cleared to a neutral placeholder (see open question 5).
  - Nothing else is touched — `swipes`, `matches`, `conversations`, `messages`, `events`, `event_members` rows the caller is linked to all remain, so other users' matches/conversations/event rosters stay intact and simply display the anonymized name going forward.
  - This is irreversible: there is no "undelete" endpoint in this slice.
- Response `200`: `{ "deleted": true }`. The caller's current JWT (and any other outstanding JWTs) is rejected on the very next request because `tokenVersion` no longer matches (same mechanism as `POST /v1/auth/password-reset/confirm`). `POST /v1/auth/login` with the old email now 401s (`email` is null, so the lookup fails), so the email becomes available for a fresh signup.

### Changed: `GET /v1/discover`

- Add `isBlocked`-style exclusion: candidates where a `blocks` row exists between caller and candidate (either direction) are excluded, in addition to the existing already-swiped/already-matched exclusions.
- Add `deletedAt IS NULL` (join `users`) so a deleted account is never suggested as a discover candidate, even if its anonymized `city`/`sport` would otherwise still match the caller's filters.

### Changed: `POST /v1/swipes`

- Before the existing self-swipe/target-exists checks: if a block exists between caller and `targetUserId` (either direction), respond `404` with the same `{ "error": "Profile not found" }` shape as a nonexistent target — do not distinguish "blocked" from "doesn't exist" in the response, mirroring `findConversationForParticipant`'s existing not-found-vs-not-a-participant indistinguishability.
- Add the same `config: { rateLimit: {...} }` as the other mutation routes (see below).

### Changed: `GET /v1/matches`

- Exclude any match where a block exists between the caller and the other participant (either direction). A blocked match simply disappears from the list on both sides; the underlying `matches`/`conversations`/`messages` rows are not deleted (see open question 2 re: unblock).

### Changed: `GET /v1/conversations`

- Same exclusion as `GET /v1/matches`: a conversation whose match is between a blocked pair disappears from both sides' list.

### Changed: `GET /v1/conversations/:conversationId/messages` and `POST /v1/conversations/:conversationId/messages`

- `findConversationForParticipant` gains the same block check and returns `null` (→ caller-facing `404`) when a block exists between the caller and the other participant, on top of its existing "doesn't exist" / "not a participant" cases — so a blocked party can't read or deep-link into the conversation, and can't post a new message into it, by querying the `conversationId` directly even though the list endpoint no longer surfaces it.
- `POST /v1/conversations/:conversationId/messages` gets the new rate-limit config (see below).

### Rate limiting (new `config.rateLimit` on existing + new mutation routes)

All of the below use a shared per-user key generator (not the IP-only default, and not `ipAndEmailKey`): resolve the caller's identity the same way `authenticate`/`resolveUserId` would (verified JWT subject, or dev `X-User-Id`) and bucket on that, falling back to `request.ip` only if no identity can be resolved. This avoids over-throttling multiple legitimate users behind one shared IP (e.g. mobile carrier NAT) and avoids under-throttling one abusive account that rotates IPs.

| Route | Limit (proposed — see open question 3) |
| --- | --- |
| `POST /v1/swipes` | 120 / 10 min |
| `POST /v1/conversations/:conversationId/messages` | 60 / 1 min |
| `POST /v1/events` | 5 / 60 min |
| `POST /v1/events/:eventId/join` | 30 / 10 min |
| `POST /v1/events/:eventId/leave` | 30 / 10 min |
| `POST /v1/blocks` | 20 / 10 min |
| `DELETE /v1/blocks/:userId` | 20 / 10 min |
| `POST /v1/reports` | 10 / 60 min |
| `DELETE /v1/me` | 3 / 60 min |

All return the existing `errorResponseBuilder` shape (`{ "error": "Too many requests" }`) with `429` on breach, same as `/v1/auth/*` today.

## Mobile UI/UX notes (`oursport/App.tsx`)

- `ProfileScreen`'s existing static "Daten & DSGVO" row ([oursport/App.tsx](../../oursport/App.tsx#L1876)) becomes a `Pressable` navigating to a new `Privacy` screen (new `RootStackParamList` entry, no params) with two sections: "Blockierte Nutzer" (list from `GET /v1/blocks`, each row with an "Entblocken" action calling `DELETE /v1/blocks/:userId`) and "Konto löschen" (a destructive row that opens a confirmation flow: a password text input + a typed/checkbox confirmation that the action is irreversible, then calls `DELETE /v1/me`; on success, clear local auth/profile state and navigate to `Welcome`, mirroring the existing `logout()` reset).
- Discover cards (inside `Matching`, [oursport/App.tsx](../../oursport/App.tsx#L864)) and the conversation header (`ConversationScreen`, [oursport/App.tsx](../../oursport/App.tsx#L1148)) each get a small "…" overflow action opening an action sheet with "Blockieren" and "Melden" options.
  - "Blockieren" calls `POST /v1/blocks` directly (simple confirm dialog, no extra form) and then removes that candidate/conversation from the local list immediately (optimistic, matching the pattern described for event join/leave in slice 4).
  - "Melden" opens a new `Report` screen/modal (new `RootStackParamList` entry: `{ userId: string; name: string }`) with a reason chip picker (`Spam`, `Belästigung`, `Fake-Profil`, `Unangemessene Inhalte`, `Sonstiges`) and an optional multiline note field, submitting to `POST /v1/reports`; include a secondary checkbox "Nutzer zusätzlich blockieren" that, if checked, also fires `POST /v1/blocks` on submit.
- `ConversationScreen`'s polling (`poll()`, [oursport/App.tsx](../../oursport/App.tsx#L1148)) should stop (or silently no-op) once the conversation 404s due to a block, and the screen should show a short inline state (e.g. "Diese Unterhaltung ist nicht mehr verfügbar.") instead of a generic error, with a way back to the Chats list.
- Surface `429` responses from any of the newly-limited mutation calls (swipe, send message, create/join/leave event, block, report, delete account) as a brief inline/toast message ("Zu viele Anfragen, bitte kurz warten.") rather than the generic error path, reusing whatever inline-error convention each screen already has (e.g. `Matching`'s inline error text).

## Acceptance criteria

1. `POST /v1/blocks` creates a block; calling it again for the same pair is a no-op (`201`, no duplicate row, no error).
2. `POST /v1/blocks`/`POST /v1/reports` return `400` for `userId === caller` and `404` for a non-existent `userId`.
3. After A blocks B: `GET /v1/discover` returns neither in the other's candidate list; `POST /v1/swipes` from either A→B or B→A returns `404`; this holds even if the caller already knows the other's `userId` from before the block (not just via discover).
4. After A blocks B with an existing match/conversation: that match disappears from `GET /v1/matches` and that conversation disappears from `GET /v1/conversations` for **both** A and B; `GET /v1/conversations/:conversationId/messages` and `POST .../messages` on that conversation's id return `404` for both A and B.
5. `DELETE /v1/blocks/:userId` removes a block the caller placed and is idempotent (`200` whether or not a block existed); it has no effect on a block the *other* party placed.
6. `GET /v1/blocks` lists only blocks the caller placed, with the blocked user's current display name.
7. `POST /v1/reports` stores a `reports` row with the given reason/note and takes no automatic action against the reported user (their visibility in discover/swipes/matches is unaffected by a report alone).
8. Each mutation route listed in the rate-limiting table returns `429` with `{ "error": "Too many requests" }` once its limit is exceeded within its window, and requests from two different authenticated users against the same route are tracked in independent buckets (not merged just because they share an IP).
9. `DELETE /v1/me` returns `401` for a wrong password (when the account has a password) and does not alter any state on a failed attempt.
10. After a successful `DELETE /v1/me`: the JWT used to call it (and any other previously issued JWT for that account) is rejected on the next authenticated request; `POST /v1/auth/login` with the old email now returns `401`; the same email can be used for a brand-new `POST /v1/auth/signup`.
11. After a successful `DELETE /v1/me`: existing matches/conversations/messages/events/event memberships involving that account are not deleted and remain visible/functional for the other participants, showing the anonymized display name instead of the original one.
12. `GET /v1/discover` never returns a deleted (`deletedAt` set) account as a candidate.
13. Mobile: the "Daten & DSGVO" profile row opens a working screen listing blocked users (with unblock) and an account-deletion flow that requires a password and an explicit confirmation before calling the API.
14. Mobile: a block or report action is reachable from both a discover card and an open conversation.

## Out of scope

- An admin/moderation dashboard or API to list, triage, or act on `reports` rows — review happens via direct DB access for now.
- Any automated moderation action (auto-suspend, content filtering/ML, shadow-banning) based on report volume or reason.
- Blocking affecting `events`/`event_members` visibility, joinability, or attendee lists — a blocked pair can still see/join each other's events in this slice (see open question 1).
- Hard-deleting or redacting individual messages/content ("unsend a message").
- Data export / "download my data" (GDPR data-portability right) — this slice only covers the deletion/erasure right.
- A grace period, confirmation email, or "cancel within N days" undo window for account deletion — deletion takes effect immediately on a successful `DELETE /v1/me` call.
- Reassigning/transferring ownership of an event created by a since-deleted account.
- Pagination on `GET /v1/blocks` (kept as a single unpaginated list given expected small scale).
- IP/device-level bans, CAPTCHAs, or any anti-abuse mechanism beyond the listed per-route rate limits.
- Configurable/admin-tunable rate limits — thresholds are hardcoded per route, same as the existing `/v1/auth/*` limits.

## Open questions

1. **Blocking and events** — should a block between A and B also hide A's created events from B (and vice versa), remove them from each other's attendee lists, or prevent one from joining the other's event? This doc deliberately scopes blocking to discover/swipe/match/conversation only, per the roadmap item's own wording ("discover ... conversations"), leaving events untouched. Confirm that's acceptable for this slice or should be added now.
2. **Does unblock fully restore the old conversation?** Because blocks are filter-only (no destructive delete of `matches`/`conversations`/`messages`), unblocking makes the prior match/conversation reappear and messaging reopen automatically. Confirm this "reversible block" behavior is desired, versus a one-way block where unblocking only re-enables future discover/swipes but does not restore the old conversation.
3. **Rate-limit thresholds** — the numbers in the table are reasonable-guess placeholders, not confirmed product/infra decisions (e.g. is 120 swipes/10 min too generous or too strict; is 5 events/60 min workable for a legitimate power user?). Confirm or adjust before implementation.
4. **`DELETE /v1/me` without a password (dev bridge)** — the non-production `X-User-Id` auth path has no password at all. This doc proposes skipping password confirmation for those accounts in non-production only. Confirm that's acceptable, or specify a different dev-only safeguard (e.g. disable `DELETE /v1/me` entirely for dev-bridge accounts).
5. **How much of `profiles` gets anonymized** — this doc proposes clearing `city`/`sport`/`level` in addition to `displayName`/`bio`/`birthDate`/coordinates. Confirm full clearing is wanted, or whether `city`/`sport`/`level` should be left in place (e.g. for aggregate analytics) since they're less directly identifying than a name.
6. **Copy/localization** — reason labels, confirmation copy, and error toasts proposed above are illustrative German strings matching the app's existing convention (e.g. "Abmelden"); exact wording is left to implementation/design review.
