# Slice 2: Discover profiles, swipes, and mutual matches

## Summary

Add a real candidate feed to the existing "Matching" tab, a like/pass action that persists, and automatic mutual-match detection that surfaces an "it's a match" moment — replacing the current hardcoded single-card placeholder with live data from the API. No chat/messaging UI is built in this slice; a match is just a record the user can see in a list.

## Current state (verified in code)

- `server/src/db/schema.ts` has `users` and `profiles` only (plus `password_reset_codes`). There is no swipe or match table.
- `server/src/index.ts` exposes `GET /v1/me`, `POST /v1/profiles`, `PATCH /v1/me`, all resolving the acting user via `resolveUserId(subject, userId, tokenVersion)`. No discover/swipe/match routes exist.
- `oursport/App.tsx`'s `Matching` component ([oursport/App.tsx](../../oursport/App.tsx#L806)) renders one hardcoded card ("Lena, 27 · Laufen · Fortgeschritten") with Pass/Like buttons that only flip local `passed`/`match` booleans in `MainTabs` ([oursport/App.tsx](../../oursport/App.tsx#L727)) — no API call, no real candidates, no persistence.
- The match overlay in `MainTabs` is hardcoded text ("Du und Lena wollt beide Laufen gehen...") with a button that navigates to the `Chats` tab.
- The `Chats` tab ([oursport/App.tsx](../../oursport/App.tsx#L866)) renders three hardcoded fake conversations; there is no conversation data model yet (that's slice 3).
- The sport filter chips above the match card are cosmetic only (`onPress={() => undefined}`); selection is purely visual against `profile?.sport`.

## User stories

1. As a logged-in user, I see a feed of other users' profiles I haven't already liked, passed, or matched with, so I can decide who to connect with.
2. As a logged-in user, I can like or pass on a candidate, and that decision is remembered so I never see the same candidate twice.
3. As a logged-in user, when someone I liked also likes me back, I immediately see an "it's a match" moment.
4. As a logged-in user, I can see a list of all my current matches at any time, even if I didn't just swipe.

## Data model changes

`server/src/db/schema.ts` — two new tables:

```ts
export const swipes = pgTable(
  "swipes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 4 }).notNull(), // "like" | "pass"
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("swipes_actor_target_unique").on(table.actorUserId, table.targetUserId),
    index("swipes_target_idx").on(table.targetUserId),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userLowId: uuid("user_low_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userHighId: uuid("user_high_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("matches_pair_unique").on(table.userLowId, table.userHighId),
    index("matches_low_idx").on(table.userLowId),
    index("matches_high_idx").on(table.userHighId),
  ],
);
```

- `swipes.action` is constrained to `"like"`/`"pass"` at the Zod layer; a DB `CHECK` constraint is a nice-to-have, not required for MVP.
- A unique `(actorUserId, targetUserId)` index means a repeat swipe on the same target **upserts** the action (lets a user correct an accidental pass) rather than creating duplicate rows.
- `matches` always stores the pair with `userLowId < userHighId` (string comparison of the UUIDs) so a pair can never be inserted twice regardless of who completed the mutual like. The match is a system-generated side effect of two reciprocal `swipes` rows, created server-side in the same transaction as the second (completing) like — it is never created directly by a client.
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only — no changes to existing tables.

## API contract

All routes require the existing Bearer-JWT / dev `X-User-Id` auth and resolve the acting user via `resolveUserId`, matching current conventions.

### New: `GET /v1/discover`

- Query params: `limit` (optional, default 20, max 50), `cursor` (optional, opaque string).
- Behavior:
  - Excludes the caller's own profile.
  - Excludes any `targetUserId` the caller already has a `swipes` row for (either `like` or `pass`).
  - Excludes any user already in a `matches` row with the caller (implied by the above, since a match requires the caller already liked them, but enforced explicitly for safety).
  - Filters candidates to `profiles.city = caller.city OR profiles.sport = caller.sport` (simple equality match, no geo-distance ranking).
  - Orders by `profiles.createdAt DESC` (newest profile first); paginates with keyset pagination (`cursor` encodes the last seen `createdAt` + `userId`) to stay stable as candidates are swiped away between pages.
- Response `200`:
  ```json
  {
    "candidates": [
      { "userId": "uuid", "name": "string", "city": "string", "sport": "string", "level": "string", "bio": "string | null" }
    ],
    "nextCursor": "string | null"
  }
  ```

### New: `POST /v1/swipes`

- Body: `{ "targetUserId": "uuid", "action": "like" | "pass" }`.
- Validation: `targetUserId` must differ from the caller's own id (`400` otherwise) and must reference a user with an existing `profiles` row (`404` otherwise).
- Behavior: upsert the caller's `swipes` row for that target. If `action === "like"`, check for a reciprocal `like` row (`targetUserId = caller`, `actorUserId = target`); if found, insert the `matches` row (`onConflictDoNothing` on the unique pair) inside the same transaction.
- Response `201`:
  ```json
  { "matched": false }
  ```
  or, when a mutual like completes a match:
  ```json
  {
    "matched": true,
    "match": { "userId": "uuid", "name": "string", "city": "string", "sport": "string" }
  }
  ```

### New: `GET /v1/matches`

- Query params: `limit` (optional, default 20, max 50), `cursor` (optional, opaque string).
- Behavior: returns all matches involving the caller (`userLowId = caller OR userHighId = caller`), newest first, joined with the other user's profile.
- Response `200`:
  ```json
  {
    "matches": [
      { "matchId": "uuid", "userId": "uuid", "name": "string", "city": "string", "sport": "string", "matchedAt": "ISO-8601 string" }
    ],
    "nextCursor": "string | null"
  }
  ```

## Mobile UI/UX notes (`oursport/App.tsx`)

- `Matching` component: replace the hardcoded card with a real queue fetched from `GET /v1/discover` on tab focus (and re-fetched when the queue empties and `nextCursor` is non-null). Keep the existing Pass(×)/Like(♥) button UI; dragging/swipe gestures are not added in this slice. Remove the fake "● 2,3 km" distance pill (no geo ranking yet).
- Each Pass/Like button press calls `POST /v1/swipes` with the current candidate's `userId` and the chosen action, then advances to the next queued candidate. On `matched: true`, show the existing match overlay using the real match's `name`/`sport` instead of the hardcoded "Lena"/"Laufen" copy.
- When the queue is exhausted and `nextCursor` is `null`, keep showing the existing "Das war's fuers Erste" empty state.
- The sport filter chips stay cosmetic (as today); wiring them to actually filter `/v1/discover` is out of scope for this slice.
- Repurpose the `Chats` tab's content into a **matches list**: fetch `GET /v1/matches` and render each match's name/city/sport with no messaging action (e.g. a disabled "Chat folgt bald" row instead of a tappable conversation). This avoids adding a new tab/nav route now and becomes the real conversation list in slice 3. The match overlay's button still navigates to this tab, relabeled e.g. "Match ansehen" instead of "Nachricht schreiben".

## Acceptance criteria

1. `GET /v1/discover` never returns the caller's own profile.
2. `GET /v1/discover` never returns a `userId` the caller has an existing `swipes` row for (either action).
3. `GET /v1/discover` only returns candidates whose `city` equals the caller's city or whose `sport` equals the caller's sport.
4. `GET /v1/discover` respects `limit` and returns a non-null `nextCursor` when more candidates exist, `null` otherwise; passing a previously returned `nextCursor` back as `cursor` returns the next page with no repeated `userId`s.
5. `POST /v1/swipes` with `action: "pass"` creates/updates a `swipes` row and returns `{ "matched": false }`; the target never appears again in that caller's `/v1/discover` results.
6. `POST /v1/swipes` with `action: "like"` when the target has not liked the caller back returns `{ "matched": false }` and creates no `matches` row.
7. `POST /v1/swipes` with `action: "like"` when the target already liked the caller creates exactly one `matches` row and returns `{ "matched": true, "match": {...} }` to the caller whose like completed the pair.
8. Re-sending `POST /v1/swipes` for the same target with a different `action` updates the existing row instead of creating a duplicate (verified by a single `swipes` row per `(actorUserId, targetUserId)` pair).
9. `POST /v1/swipes` with `targetUserId` equal to the caller's own id returns `400`; with a `targetUserId` that has no `profiles` row returns `404`.
10. `GET /v1/matches` returns a match exactly once (not duplicated for each side) and only to the two users involved in it, newest first.
11. Mobile: swiping like on a candidate that reciprocates shows the match overlay with that candidate's real name; swiping pass removes the candidate from the visible queue and it does not reappear after a tab switch.
12. Mobile: the repurposed matches tab lists all of the current user's matches fetched from `GET /v1/matches`, with no crash or placeholder "Lena" data remaining.

## Out of scope

- Real geo-distance calculation or ranking (existing `latitude`/`longitude` columns are not used here).
- Drag/swipe gesture interactions (buttons only).
- Working sport/city filter chips in the UI.
- Blocking, reporting, or undoing/"rewinding" a swipe (slice 5).
- Any conversation/messaging data model or UI — a match is a terminal record in this slice (slice 3).
- Un-matching (deleting a `matches` row).
- Push notifications for new matches.
- Rate limiting of swipe spam (left for a later hardening pass, consistent with how slice 1 added rate limiting after the base auth flow existed).

## Open questions

1. **City/sport filter is OR, not AND** — a candidate matches if *either* city or sport matches the caller's profile, to keep the pool large while the user base is small. Confirm this is acceptable, or should it be AND (stricter, smaller pool) once there are more users?
2. **Matches tab reuse** — this doc proposes repurposing the existing `Chats` tab to show the matches list now (since no messaging exists yet) rather than adding a new nav tab. Confirm this is the preferred UX, versus adding a dedicated "Matches" tab/screen that slice 3 later converts into a chat list.
3. **Re-swipe semantics** — upserting lets a user flip a `pass` to a `like` (or vice versa) by swiping again on a resurfaced... but since passed/liked users never resurface in `/v1/discover`, there is currently no UI path to trigger a second swipe on the same target. Confirm the upsert behavior is still wanted (e.g. for a future "review passed profiles" feature) or whether the first swipe should simply be immutable for this slice.
4. **Candidate ordering** — "newest profile first" is a placeholder heuristic with no real relevance signal. Acceptable for MVP, or is a random/shuffled order preferred to avoid always surfacing the same early candidates first to everyone?
