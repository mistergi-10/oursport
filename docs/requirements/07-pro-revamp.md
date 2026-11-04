# Slice 7: Pro revamp — smarter matching, smarter events, real-time chat, notifications, maps, and UI polish pass 2

## Summary

Address blunt product-owner feedback ("only shit", "not a pro version") with a second, concrete pass across the app's core loops: fix real discover/swipe weaknesses and add relevance-based ranking, turn Events into an actual "find a sport activity" feature (recommendations, real search, waitlists), replace conversation polling with WebSockets, add web push notifications (native push explicitly deferred — no Apple/Google developer accounts exist), and do a second, more opinionated UI/UX polish pass on top of the slice-6 design system. Maps keeps its existing deep-link-to-Google-Maps approach (no paid Maps API key available).

## Current state (verified in code)

### Matching / Discover / Swipes

- `GET /v1/discover` ([server/src/index.ts](../../server/src/index.ts#L459)) filters candidates with `or(eq(profiles.city, callerProfile.city), eq(profiles.sport, callerProfile.sport))` ([server/src/index.ts](../../server/src/index.ts#L499)) and orders results with `orderBy(desc(profiles.createdAt), desc(profiles.userId))` ([server/src/index.ts](../../server/src/index.ts#L534)) — "newest profile first", not relevance. There is no scoring of city match vs. sport match vs. level similarity vs. recency; a candidate in the right city but a totally different sport ranks identically to a perfect sport+city match, and a profile created yesterday always outranks a better-fitting profile created last month. This is the concrete root of "matching doesn't feel smart".
- `profiles.latitude`/`profiles.longitude` exist in the schema ([server/src/db/schema.ts](../../server/src/db/schema.ts#L40)-[L41](../../server/src/db/schema.ts#L41)) and are captured at profile-save time, but `GET /v1/discover` never reads or ranks by them — real geo-distance ranking is possible today with zero new columns and isn't used.
- The mobile sport-filter chip row in `Matching` only shows `sports.slice(0, 4)` ([oursport/screens/Matching.tsx](../../oursport/screens/Matching.tsx#L163)) — two of the six configured sports (`sports` has 6 entries, [oursport/lib/constants.ts](../../oursport/lib/constants.ts)) are never selectable as a discover filter, with no visual indication more exist.
- `POST /v1/swipes`'s `matched: true` response only returns `{ userId, name, city, sport }` ([server/src/index.ts](../../server/src/index.ts#L640)-[L647](../../server/src/index.ts#L647)); it never returns the `conversationId` that was just created in the same transaction ([server/src/index.ts](../../server/src/index.ts#L625)-[L629](../../server/src/index.ts#L625)). Concretely, the match overlay in `MainTabs` ([oursport/screens/MainTabs.tsx](../../oursport/screens/MainTabs.tsx#L71)-[L76](../../oursport/screens/MainTabs.tsx#L76)) can only navigate to `Main` → `Chats` (the conversation list), never straight into the new conversation — a confirmed UX dead-end: the user gets excited by a match, taps "Match ansehen", and lands on a list instead of a chat.
- `MatchInfo` ([oursport/lib/types.ts](../../oursport/lib/types.ts#L37)) has no `conversationId` field, confirming the gap is both client- and server-side.

### Events

- `GET /v1/events` only supports exact (case-insensitive) `city`/`sport` equality filters — `eq(sql`lower(${events.city})`, query.city.toLowerCase())` ([server/src/index.ts](../../server/src/index.ts#L1020)) — there is no free-text title/description search and no partial/fuzzy city match (e.g. "Berl" does not find "Berlin").
- There is no "recommended"/"for you" endpoint or section anywhere — `Events` ([oursport/screens/Events.tsx](../../oursport/screens/Events.tsx#L20)) renders one plain, unsegmented, chronological list from `GET /v1/events`. A user's own `profiles.sport`/`profiles.city` (already known from their profile) is never used to surface relevant events first.
- Joining a full event is a hard block: `memberRows.length >= core.capacity` returns `{ status: "full" }` → `409` ([server/src/index.ts](../../server/src/index.ts#L1104), [server/src/index.ts](../../server/src/index.ts#L1113)), and the mobile join button simply disables itself with `"Ausgebucht"` copy (`eventJoinLabel`, [oursport/lib/format.ts](../../oursport/lib/format.ts#L34)) once `spotsLeft === 0` ([oursport/screens/Events.tsx](../../oursport/screens/Events.tsx#L206)-[L210](../../oursport/screens/Events.tsx#L210); [oursport/screens/EventDetailScreen.tsx](../../oursport/screens/EventDetailScreen.tsx#L142)). There is no waitlist table, no "notify me if a spot opens" path, and no automatic promotion when a member leaves.
- There are no recurring events: `events` has a single `startsAt` ([server/src/db/schema.ts](../../server/src/db/schema.ts#L139), confirmed by the `eventCreateSchema` shape, [server/src/index.ts](../../server/src/index.ts#L85)-[L93](../../server/src/index.ts#L93)) and no `recurrenceRule`/`seriesId` concept; a weekly 5-a-side game must be recreated by hand every week.
- There are no event reminders of any kind (no scheduled push/email/in-app notification ahead of `startsAt`).
- `docs/requirements/04-events-membership.md`'s own "Out of scope" section already named most of these gaps (recurring events, waitlists, reminders) as deliberately deferred — this slice is where they get picked up.

### Real-time chat

- `ConversationScreen` polls `GET /v1/conversations/:id/messages` every 4 seconds via `setInterval(..., 4000)` while focused ([oursport/screens/ConversationScreen.tsx](../../oursport/screens/ConversationScreen.tsx#L155)-[L167](../../oursport/screens/ConversationScreen.tsx#L167)), confirming the documented polling-only design from [docs/requirements/03-conversations-messages.md](03-conversations-messages.md)'s "Out of scope" section. No websocket/SSE transport exists anywhere in `server/src/index.ts` or `oursport/lib/api.ts`.
- `server/package.json` ([server/package.json](../../server/package.json)) has no `@fastify/websocket` dependency (or any other websocket library) today.

### Push notifications

- Neither `oursport/package.json` ([oursport/package.json](../../oursport/package.json)) nor `oursport/app.json` ([oursport/app.json](../../oursport/app.json)) references `expo-notifications`, any push credential config (`android.googleServicesFile`, `ios.config.googleServicesFile`, EAS push credentials), or any VAPID/web-push config. No push infrastructure of any kind exists yet.

### Maps

- `EventDetailScreen` already deep-links to Google Maps search via `Linking.openURL` with a `google.com/maps/search` URL built from the event's title/city ([oursport/screens/EventDetailScreen.tsx](../../oursport/screens/EventDetailScreen.tsx#L116)-[L121](../../oursport/screens/EventDetailScreen.tsx#L121)) rather than an embedded map view. No maps SDK (`react-native-maps`, Google Maps JavaScript API, Mapbox, etc.) or API key is configured in `app.json`/`package.json`.

### UI/UX ("plain"/"amateurish")

Slice 6 ([docs/requirements/06-design-system-ui-polish.md](06-design-system-ui-polish.md)) already shipped a token system (`typography`/`spacing`/`radius` in [oursport/theme/tokens.ts](../../oursport/theme/tokens.ts)), shared `Button`/`Card`/`EmptyState`/`Skeleton`/`Chip` components, drag-to-swipe (`SwipeCard`, [oursport/components/SwipeCard.tsx](../../oursport/components/SwipeCard.tsx)), an animated match overlay (`MotiView`, [oursport/screens/MainTabs.tsx](../../oursport/screens/MainTabs.tsx#L57)-[L68](../../oursport/screens/MainTabs.tsx#L68)), and accessibility labels — `docs/PROJECT_CONTEXT.md` had stated slice 6 as still "next", which was stale and is corrected below. On top of that shipped baseline, concrete remaining weaknesses:

- `WelcomeScreen` ([oursport/screens/WelcomeScreen.tsx](../../oursport/screens/WelcomeScreen.tsx)) is a single static screen (logo, tagline, three bullet feature rows, two buttons) with one fade/rise entrance animation — there is no swipeable onboarding carousel, no illustration artwork, and no differentiation between first-launch and every subsequent app open (a returning user sees the identical "sales pitch" screen every time they log out).
- There is no home/discovery "hero" moment anywhere — `Matching` ([oursport/screens/Matching.tsx](../../oursport/screens/Matching.tsx#L160)-[L162](../../oursport/screens/Matching.tsx#L162)) opens directly on a plain `Header` + filter-chip row + card stack, with no greeting, stats, or daily-highlight content to make the home experience feel considered.
- Empty states (`EmptyState`, [oursport/components/EmptyState.tsx](../../oursport/components/EmptyState.tsx)) use a single Ionicon per state with no illustration-level visual treatment, confirming the slice-6 "Out of scope" note that a full illustration set was deliberately deferred.
- No haptics anywhere: `expo-haptics` is absent from [oursport/package.json](../../oursport/package.json), so swipe commits, match celebration, join/leave, and send-message actions have zero tactile feedback — a hallmark of "pro" mobile apps (e.g. Tinder/Strava-style swipe-confirm haptics) that this app entirely lacks.
- Every screen shares the same flat `cloud`/`court` background ([oursport/theme/tokens.ts](../../oursport/theme/tokens.ts#L19)-[L34](../../oursport/theme/tokens.ts#L34)) with no per-screen visual identity (e.g. a gradient/hero header on Matching vs. Events vs. Profile) — the app currently reads as one undifferentiated template reused five times.

## Pillar 1 — Smarter matching

### User stories

1. As a user, candidates who genuinely fit me (same sport **and** city, or close by) are ranked above weaker matches (only city, or only sport), instead of the newest profile always winning.
2. As a user with a saved location, closer candidates are ranked above farther ones when sport/city match quality is otherwise equal.
3. As a user, I can filter discover by any of the app's configured sports, not just the first four.
4. As a user, the instant I get a match, I can jump straight into the conversation with that person instead of landing on a list I then have to tap into again.

### API contract changes

- **Changed: `GET /v1/discover`** — ranking becomes a computed relevance score instead of pure `createdAt DESC`:
  - Score components (highest to lowest weight): exact `sport` match, exact `city` match, geo-distance when both caller and candidate have `latitude`/`longitude` set (closer = higher score, bucketed e.g. `<10km` / `<50km` / `<200km` / unknown), then `createdAt DESC` as the final tiebreaker.
  - Keyset pagination changes from `(createdAt, userId)` to `(score, createdAt, userId)` — the `cursor` opaque string encodes all three so stable pagination is preserved as today (acceptance criterion 4 of slice 2 still holds, just against the new sort key).
  - The existing `sport` query param (exact filter, not just a ranking signal) and the city/sport `OR` inclusion rule from slice 2 are unchanged — this is a ranking change, not an inclusion-criteria change, so no previously-returned candidate becomes invisible.
- **Changed: `POST /v1/swipes`** — the `matched: true` response gains a `conversationId`:
  ```json
  {
    "matched": true,
    "match": { "userId": "uuid", "name": "string", "city": "string", "sport": "string" },
    "conversationId": "uuid"
  }
  ```
  The value is read from the `conversations` row already inserted in the same transaction ([server/src/index.ts](../../server/src/index.ts#L625)-[L629](../../server/src/index.ts#L625)) — no new table or migration needed.

### Data model changes

None. Ranking uses existing `profiles.latitude`/`longitude`/`sport`/`city`/`createdAt` columns; the `conversationId` addition reads an existing row.

### Mobile UI/UX notes

- `Matching`'s sport filter chip row shows all configured sports (horizontally scrollable, as already implemented), not just the first four — remove the `.slice(0, 4)` cap ([oursport/screens/Matching.tsx](../../oursport/screens/Matching.tsx#L163)).
- The match overlay's "Match ansehen" button navigates directly to the `Conversation` screen using the new `conversationId` (and the match's `name`/`userId` for the existing `Conversation` route params), instead of `Main` → `Chats`.

### Acceptance criteria

1. `GET /v1/discover` returns a candidate whose `sport` and `city` both match the caller above a candidate matching only one of the two, all else equal.
2. `GET /v1/discover` returns a closer candidate (by `latitude`/`longitude`) above a farther one when sport/city match quality is equal and both profiles have coordinates set.
3. `GET /v1/discover` pagination (`cursor`/`nextCursor`) still returns no repeated `userId`s across pages under the new sort key.
4. The `Matching` screen's sport filter row offers every sport in the `sports` constant, not a subset.
5. `POST /v1/swipes` with `action: "like"` that completes a match returns a non-null `conversationId` alongside `matched: true`.
6. Tapping "Match ansehen" in the match overlay opens the `Conversation` screen for that match directly (not the Chats list), with message history loading immediately.

### Out of scope

- Machine-learned/behavioral ranking (e.g. based on who the user tends to like) — this pillar is a deterministic, explainable scoring formula only.
- Changing the city/sport `OR` inclusion rule from slice 2 (still an open product decision — see Decisions below for the resolution taken here).
- Undo/rewind of a swipe.

## Pillar 2 — Smarter events

### User stories

1. As a user, I see a "For you" section of events that match my own profile's sport/city before the general chronological list, so the most relevant activities surface first.
2. As a user, I can search events by free text (title, description) in addition to filtering by city/sport.
3. As a user, when an event is full, I can join a waitlist instead of just seeing a disabled button, and I'm automatically promoted to attending if a spot frees up.
4. As a user, I can create a recurring weekly/biweekly event instead of re-creating the same game by hand every time.

### Data model changes

`server/src/db/schema.ts` — one changed table, two new tables:

```ts
// events gains two nullable recurrence columns (additive, backward compatible)
export const events = pgTable("events", {
  // ...existing columns unchanged...
  recurrenceRule: varchar("recurrence_rule", { length: 20 }), // "weekly" | "biweekly" | null
  seriesId: uuid("series_id"), // groups generated occurrences of the same recurring event; null for one-off events
});

export const eventWaitlist = pgTable(
  "event_waitlist",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_waitlist_event_user_unique").on(table.eventId, table.userId),
    index("event_waitlist_event_position_idx").on(table.eventId, table.joinedAt),
  ],
);
```

- `recurrenceRule`/`seriesId` are both nullable so every existing one-off event row stays valid with no backfill. Creating a `"weekly"`/`"biweekly"` event generates a fixed batch of future occurrence rows (see open Decision on batch size) sharing one `seriesId`, each a normal independent `events` row (own `event_members`, own capacity) — there is no "edit the series" operation in this slice, matching the existing "events are immutable after creation" convention from slice 4.
- `event_waitlist`'s unique `(eventId, userId)` index makes joining the waitlist idempotent; `joinedAt` gives FIFO promotion order.
- A free-text search does not need a new column: Postgres `ILIKE` against `title`/`description` is sufficient at this data volume (no new index required beyond the existing `events_sport_city_starts_idx`; a `pg_trgm` GIN index is a reasonable follow-up if search volume grows, not required for this slice).
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only — no changes to existing `events`/`event_members` column types.

### API contract changes

- **New: `GET /v1/events/for-you`** — same auth/pagination convention as `GET /v1/events`. Behavior: same future-only filter as `GET /v1/events`, restricted to events matching the caller's own `profiles.sport` or `profiles.city` (same `OR` convention as discover), ordered soonest-first. Response shape identical to `GET /v1/events`'s `{ events: EventSummary[], nextCursor }`.
- **Changed: `GET /v1/events`** — gains an optional `q` query param (trimmed string, 1-120 chars): when present, filters to events whose `title` or `description` `ILIKE '%q%'` (case-insensitive substring), in addition to any `city`/`sport` filters (all filters AND together, consistent with existing filter semantics). `city`/`sport` filters remain exact match (unchanged) — `q` is the new free-text layer.
- **New: `POST /v1/events/:eventId/waitlist`** — path param `eventId`. No body. Behavior (inside the same `pg_advisory_xact_lock(hashtext(eventId))` transaction already used for join): `404` if the event doesn't exist; `400` if already attending or already the creator; no-op `200` if already on the waitlist; otherwise insert an `event_waitlist` row. Response: the event detail shape plus `waitlistPosition: number` (1-based).
- **New: `POST /v1/events/:eventId/waitlist/leave`** — path param `eventId`. No body. Removes the caller's `event_waitlist` row if present (idempotent `200` either way).
- **Changed: `POST /v1/events/:eventId/leave`** — after removing the leaving member, if any `event_waitlist` rows exist for the event (ordered by `joinedAt ASC`), the earliest-joined waitlisted user is automatically promoted: their `event_waitlist` row is deleted and an `event_members` row inserted for them, inside the same transaction. No notification mechanism is required by this endpoint itself — see Pillar 4 for how the promoted user is told.
- **Changed: `GET /v1/events/:eventId`** and **`GET /v1/events`** response shapes gain `waitlistCount: number` and (for the calling user) `isWaitlisted: boolean`, alongside the existing `attendeeCount`/`spotsLeft`/`isAttending`.
- **Changed: `POST /v1/events`** — body gains an optional `recurrence: "weekly" | "biweekly"` field (omitted/absent = one-off, unchanged behavior). When present, the server creates the first event plus a fixed number of future occurrences (see Decisions) sharing a new `seriesId`, each independently joinable/leavable; response is the first occurrence's detail (unchanged shape), with `seriesId` added to `EventSummary`/`EventDetail`.

### Mobile UI/UX notes

- `Events` tab gains a "Für dich" horizontal section (event cards, same `Card` styling) above the existing vertical chronological list, sourced from `GET /v1/events/for-you`; hidden entirely if empty rather than showing an empty rail.
- The existing city text input becomes a general search box (placeholder updated to "Suche nach Ort oder Stichwort") whose value is sent as both `city` (if it looks like a plain filter, i.e. unchanged behavior) is replaced by sending the box's value as the new `q` param instead, with the sport chip row unchanged — this keeps one input instead of two separate search affordances (see Decisions for the exact resolution of "one merged box vs. two fields").
- When `spotsLeft === 0` and the caller isn't attending, the join button's "Ausgebucht" disabled state ([oursport/lib/format.ts](../../oursport/lib/format.ts#L34)) is replaced with an enabled "Warteliste beitreten" (or "Warteliste verlassen · Platz N" once joined) button calling the new waitlist endpoints, both in `Events` list rows and `EventDetailScreen`.
- `CreateEventScreen` gains a "Wiederholung" chip row (`Einmalig` / `Wöchentlich` / `Alle 2 Wochen`) under the date/time fields, sent as `recurrence` on submit.

### Acceptance criteria

1. `GET /v1/events/for-you` only returns events matching the caller's own `sport` or `city`, future-only, soonest-first, with no repeated `eventId`s across pages.
2. `GET /v1/events?q=...` returns events whose `title` or `description` contains the query text (case-insensitive), combined with any active `city`/`sport` filters.
3. `POST /v1/events/:eventId/waitlist` returns `400` if the caller is already attending or is the creator, and a stable 1-based `waitlistPosition` otherwise.
4. `POST /v1/events/:eventId/leave` on an event with a non-empty waitlist promotes exactly the earliest-joined waitlisted user to `event_members` and removes them from `event_waitlist`, leaving `attendeeCount` unchanged (one left, one promoted) and `waitlistCount` decremented by one.
5. `POST /v1/events` with `recurrence: "weekly"` (or `"biweekly"`) creates the requested number of future occurrences (see Decisions for the exact count) sharing one `seriesId`, each independently listed by `GET /v1/events` and independently joinable/leavable.
6. Mobile: the Events tab's "Für dich" section only renders when `GET /v1/events/for-you` returns at least one event.
7. Mobile: the search box filters the visible list by title/description substring in addition to the existing city/sport chip filters.
8. Mobile: joining a full event's waitlist and later being promoted (verified by re-fetching after another member leaves) flips the event's state to "attending" with no manual re-join action required.

### Out of scope

- Editing/cancelling an already-created recurring series (the per-occurrence immutability convention from slice 4 is unchanged).
- A dedicated "My events" filter/view (still deferred, per slice 4's open question 4).
- Fuzzy/typo-tolerant search (exact substring `ILIKE` only).
- Any notification *content* for waitlist promotion beyond what Pillar 4's push-notification plumbing delivers generically (this pillar only guarantees the server-side promotion happens).

## Pillar 3 — Real-time chat

### User stories

1. As a matched user, messages I send and receive appear immediately, without a multi-second polling delay.
2. As a developer/operator, if a user's connection can't sustain a WebSocket (corporate proxy, flaky network), the conversation still works via the existing polling fallback.

### API contract changes

- **New: WebSocket endpoint `GET /v1/ws`** (upgraded via `@fastify/websocket`), authenticated the same way as REST routes (Bearer JWT or dev `X-User-Id`, passed as a query param or the initial connection header depending on client capability — exact mechanism is an implementation detail, not a contract change visible to other endpoints).
  - On connect, the server associates the socket with the caller's `userId`.
  - Server → client event: `{ "type": "message", "conversationId": "uuid", "message": { "messageId", "senderUserId", "body", "createdAt" } }`, pushed to both participants of a conversation immediately after `POST /v1/conversations/:conversationId/messages` persists a new row.
  - No client → server chat events in this slice (sending still goes through the existing `POST /v1/conversations/:conversationId/messages` REST route; the socket is receive-only for messages). This keeps the write path's validation/auth logic in one place instead of duplicating it over the socket.
- **Unchanged:** `GET /v1/conversations/:conversationId/messages` and `POST /v1/conversations/:conversationId/messages` keep their existing shapes and remain the source of truth; the socket is an additive low-latency notification channel, not a replacement data path.

### Data model changes

None — no new tables; `@fastify/websocket` added as a new server dependency.

### Mobile UI/UX notes

- `ConversationScreen` opens a WebSocket connection on focus (alongside, not instead of, its existing `loadInitial` REST call) and appends incoming `message` events for the active `conversationId` directly into `messagesList`, the same way a polled message is merged today ([oursport/screens/ConversationScreen.tsx](../../oursport/screens/ConversationScreen.tsx#L153)-[L167](../../oursport/screens/ConversationScreen.tsx#L167)).
- The existing 4-second poll ([oursport/screens/ConversationScreen.tsx](../../oursport/screens/ConversationScreen.tsx#L155)-[L167](../../oursport/screens/ConversationScreen.tsx#L167)) is kept as a fallback but its interval is relaxed (e.g. to 15-20 seconds) once a socket connection is confirmed open, and falls back to the original 4-second cadence if the socket disconnects/fails to connect — "polling fallback acceptable" per the roadmap brief.
- The Chats list (`MatchesList`) optionally subscribes to the same socket to live-update last-message previews without a manual pull-to-refresh (nice-to-have within this pillar, not a separate acceptance-blocking item — see acceptance criteria).

### Acceptance criteria

1. A message sent from one account appears in the other matched account's open `Conversation` screen within ~1 second under normal network conditions (verified manually; no fixed SLA test required).
2. If the WebSocket connection fails or is unavailable, the `Conversation` screen still functions correctly via the existing polling path, with no crash or stuck loading state.
3. Closing/backgrounding the `Conversation` screen closes its WebSocket connection (no leaked open sockets after navigating away, mirroring the existing "polling stops when unfocused" behavior).
4. No change to `POST /v1/conversations/:conversationId/messages`'s request/response shape or validation rules.

### Out of scope

- Typing indicators, read-receipt delivery over the socket (read receipts already exist as a REST call, [server/src/index.ts](../../server/src/index.ts#L843); not moved to the socket in this slice).
- Horizontal scaling/pub-sub fan-out for multiple server instances (e.g. Redis pub/sub) — acceptable to assume a single API process for this slice, consistent with the project's current Render deployment; flagged as a scaling follow-up, not blocking.
- Sending messages over the socket (write path stays REST-only, as stated above).

## Pillar 4 — Push notifications

### Decisions context

Native push (FCM for Android, APNs for iOS) requires a Google Play/Firebase project and an Apple Developer Program membership — credentials this team does not currently have. **Web push (VAPID)** is free, requires no third-party developer account, and works directly against the Render web deployment the product owner is actually testing (`https://oursport-web.onrender.com`). This pillar scopes web push as the in-scope default; native push is explicitly flagged as later/blocked (see Decisions).

### User stories

1. As a user of the web app, I can opt in to browser push notifications for new matches, new messages, and (from Pillar 2) waitlist promotions, so I don't have to keep the tab open/polling to notice activity.
2. As a user, I can turn notifications off again from my profile/settings at any time.

### Data model changes

`server/src/db/schema.ts` — one new table:

```ts
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dhKey: text("p256dh_key").notNull(),
    authKey: text("auth_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("push_subscriptions_endpoint_unique").on(table.endpoint),
    index("push_subscriptions_user_idx").on(table.userId),
  ],
);
```

- One user can have multiple subscriptions (multiple browser/device sessions); `endpoint` is unique per the Web Push spec.
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only.

### API contract changes

- **New: `GET /v1/push/public-key`** — returns `{ "publicKey": "string" }`, the server's VAPID public key (`VAPID_PUBLIC_KEY` env var, matching the project's existing "secrets in env vars" convention).
- **New: `POST /v1/push/subscribe`** — body: `{ "endpoint": "string", "keys": { "p256dh": "string", "auth": "string" } }` (the standard `PushSubscription.toJSON()` shape). Upserts a `pushSubscriptions` row for the caller (`onConflictDoUpdate` on `endpoint`, re-associating it with the current caller in case of account switch on a shared browser). Response `201`.
- **New: `POST /v1/push/unsubscribe`** — body: `{ "endpoint": "string" }`. Deletes the matching row for the caller. Response `200`.
- **Changed (server-internal only, no new client-facing shape):** `POST /v1/swipes` (on match), `POST /v1/conversations/:conversationId/messages` (new message), and `POST /v1/events/:eventId/leave` (on waitlist promotion) each send a best-effort web-push payload to the relevant other user's subscriptions after their existing transaction commits. A delivery failure (expired subscription, network error) is logged and does not fail or roll back the triggering request — push is additive, never a hard dependency of the core action.

### Mobile UI/UX notes

- `ProfileScreen` gains a "Benachrichtigungen" toggle (web-only; hidden or disabled with explanatory copy on native, since native push is out of scope — see Decisions). Enabling it requests the browser's `Notification` permission, registers a Service Worker (`expo` web build already serves one per `oursport/CLAUDE.md`'s existing PWA-adjacent setup — confirm/extend it rather than introducing a second one), subscribes via the Push API using the key from `GET /v1/push/public-key`, and posts the result to `POST /v1/push/subscribe`. Disabling it calls `POST /v1/push/unsubscribe` and unsubscribes locally.

### Acceptance criteria

1. `GET /v1/push/public-key` returns a non-empty key sourced from an environment variable, never hardcoded.
2. `POST /v1/push/subscribe` with a valid subscription payload is idempotent for the same `endpoint` (re-subscribing updates rather than duplicates).
3. A new mutual match triggers a web push notification to the other matched user's subscribed browsers (verified manually against a real browser subscription in a dev/staging check).
4. A new message triggers a web push notification to the message recipient, but only when they are not actively connected to Pillar 3's WebSocket for that conversation (avoids double-notifying someone with the chat already open).
5. Disabling notifications in `ProfileScreen` stops further pushes to that subscription (`POST /v1/push/unsubscribe` removes the row; no further `push_subscriptions` row exists for that `endpoint` afterward).
6. No native push dependency (`expo-notifications`, FCM/APNs config) is added in this slice.

### Out of scope

- Native push via FCM/APNs — explicitly blocked on missing Apple/Google developer credentials (see Decisions).
- Per-notification-type opt-out granularity (matches vs. messages vs. waitlist) — one app-wide toggle only in this slice.
- Notification history/inbox UI.
- Email notifications as a channel.

## Pillar 5 — Maps

### Decisions context

A real embedded map (e.g. Google Maps JavaScript API/SDK, Mapbox) requires a paid or credit-card-gated API key at any meaningful usage volume, and the project has none configured today ([oursport/app.json](../../oursport/app.json) has no maps config; no key in any env reference). This pillar keeps the existing deep-link-to-Google-Maps approach ([oursport/screens/EventDetailScreen.tsx](../../oursport/screens/EventDetailScreen.tsx#L116)-[L121](../../oursport/screens/EventDetailScreen.tsx#L121)) and scopes only a small, free improvement on top of it.

### User stories

1. As a user viewing an event, I see a static map preview of the approximate location before I decide to leave the app to open full Google Maps.

### API contract changes

None.

### Mobile UI/UX notes

- `EventDetailScreen` adds a tappable static map preview image above the existing "In Karte öffnen" link, using OpenStreetMap's free static tile rendering (no API key required) keyed off the event's `city` — this is a visual preview only, not an interactive/embedded map, and degrades gracefully (hidden, not broken) if the image fails to load. Tapping the preview opens the same Google Maps deep link as the existing button.

### Acceptance criteria

1. `EventDetailScreen` shows a static map preview image for the event's city with no new paid API key or billing-gated dependency.
2. If the static map image fails to load, the screen still renders correctly with the existing "In Karte öffnen" deep link intact (no crash, no broken-image placeholder left visible).

### Out of scope

- A real interactive/embeddable map (pan/zoom, pins for nearby events, user location puck) — explicitly blocked on a paid Maps API key; see Decisions.
- Precise lat/long-based map pins (the static preview is keyed off `city` text, consistent with the existing deep-link's city-based query).

## Pillar 6 — UI/UX pro polish pass 2

### User stories

1. As a first-time user, I see a short onboarding carousel introducing the app's three core loops (matching, events, chat) before landing on sign-up, instead of one static sales-pitch screen every time.
2. As a user, the Matching tab's opening moment feels considered (a small greeting/stat), not just a bare header and card stack.
3. As a user, key actions (swipe commit, match celebration, event join, message send) give a brief haptic tap, reinforcing that pro-app feel.
4. As a user, each major tab (Matching, Events, Chats, Profile) has a subtly distinct visual accent so the app doesn't feel like one template copy-pasted five times.

### Data model changes

None.

### API contract changes

None.

### Mobile UI/UX notes

- Add `expo-haptics` as a new dependency; wire `impactAsync(ImpactFeedbackStyle.Light)` on swipe-commit ([oursport/screens/Matching.tsx](../../oursport/screens/Matching.tsx#L109), `handleCommit`) and event join/leave, and `notificationAsync(NotificationFeedbackType.Success)` on the match overlay appearing ([oursport/screens/MainTabs.tsx](../../oursport/screens/MainTabs.tsx#L57)) and on message send — all gated behind the existing `useReducedMotion()` check being false is not required (haptics are a different accessibility axis than motion), but each call is wrapped so it no-ops silently on web (`expo-haptics` is native-only).
- `WelcomeScreen` becomes a 3-slide swipeable onboarding carousel (reusing `moti`/`react-native-reanimated`, already dependencies) shown only on first app launch (persisted via the existing `AsyncStorage` usage, a new `hasSeenOnboarding` flag) — one slide per core loop (Matching, Events, Chat), each with a short headline/illustration-style Ionicon composition and a dot-page indicator; the existing two auth buttons move to the final slide. Returning users (flag already set) skip straight to the existing single welcome screen.
- `Matching` gains a small header greeting row above the filter chips (e.g. "Hallo, {profile name} 👋" plus a subtle one-line stat such as "{n} neue Profile in deiner Nähe" sourced from the existing `GET /v1/discover` response count — no new endpoint needed).
- Each tab's `Header` component ([oursport/components/Header.tsx](../../oursport/components/Header.tsx)) accepts an optional `accentColor` prop, used to tint that screen's header icon/underline (Matching → `volt`, Events → `ember`, Chats → existing `ink`, Profile → `mist`) — a small, low-risk way to differentiate tabs without a full re-theme.

### Acceptance criteria

1. A first-ever app launch shows the 3-slide onboarding carousel; a subsequent launch (same device/browser storage) shows the existing single welcome screen directly.
2. Swiping a candidate, confirming a match, joining/leaving an event, and sending a message each trigger a native haptic on iOS/Android (no-op without error on web).
3. The `Matching` tab's header area shows a personalized greeting using the current user's profile name.
4. Each of the four main tabs renders its header with a visually distinct accent color, verified by inspecting the rendered `Header` prop per screen.
5. `npm run web` (or `tsc --noEmit`) in `oursport/` passes with no new TypeScript errors after these additions.

### Out of scope

- A full custom illustration/mascot set (still deferred from slice 6).
- Per-tab background/theme overhaul beyond the header accent (e.g. distinct gradients per screen) — a larger visual-identity pass is left for a future slice if the accent-only approach proves insufficient.
- Localization of any new copy (German-only, consistent with the rest of the app).

## Decisions

Per this project's established convention (product owner pre-approves the maximal option on in-house-feasible questions), the following are decided rather than left open:

1. **Discover ranking weights and geo-distance buckets (Pillar 1)**: approved as specified — sport+city match ranks highest, then single-field match, then geo-distance buckets (`<10km`/`<50km`/`<200km`/unknown), then recency as the final tiebreaker. No further sign-off needed to implement.
2. **City/sport `OR` inclusion rule (carried over from slice 2's open question 1)**: stays `OR` (not `AND`) — this slice's smarter *ranking* (Pillar 1) addresses the "feels random" complaint without needing to shrink the candidate pool, which would hurt matching in a still-small user base.
3. **Recurring event occurrence batch size (Pillar 2)**: approved at a fixed 8 future occurrences generated at creation time (roughly 2 months of weekly, 4 months of biweekly) — enough to feel "recurring" without unbounded row growth; the creator can simply create a new batch once they run low (no "extend series" UI in this slice).
4. **Search box UX — merged vs. separate fields (Pillar 2)**: approved — the existing city text input becomes one merged free-text search box (sent as `q`), rather than adding a second separate search field, to avoid cluttering the already-busy filter row.
5. **WebSocket auth transport (Pillar 3)**: approved to pass the existing Bearer JWT (or dev `X-User-Id`) as a connection query parameter (`/v1/ws?token=...`) rather than a custom subprotocol handshake — simplest to implement against `@fastify/websocket` and consistent with common practice for browser WebSocket clients, which cannot set arbitrary headers on the initial handshake.
6. **Push notification toggle granularity (Pillar 4)**: approved as one app-wide on/off toggle for this slice (no per-type opt-out) — simplest to ship; per-type granularity is a reasonable low-risk follow-up, not required now.
7. **Static map preview provider (Pillar 5)**: approved to use OpenStreetMap's free static tile service for the preview image — no account/key required, consistent with keeping this slice free of new paid dependencies.
8. **Onboarding persistence key (Pillar 6)**: approved to store `hasSeenOnboarding` in the existing `AsyncStorage` (same mechanism already used for the local profile cache), scoped per-device/per-browser (a user re-sees onboarding once per new device/browser, which is acceptable and simpler than a server-side "has onboarded" profile flag).

### Genuinely open questions (require something the team can't unilaterally provide)

1. **Native push (FCM/APNs)**: blocked on an Apple Developer Program membership (paid, ~$99/year) and a Google/Firebase project for FCM credentials. **Recommendation**: ship Pillar 4's web-push scope now (free, works on the deployed web app the product owner is testing); revisit native push once/if those accounts are obtained. This is a real product gap for native iOS/Android installs specifically, not a web gap.
2. **Real embedded/interactive maps**: blocked on a paid (or credit-card-gated) Google Maps/Mapbox API key — not feasible to provision unilaterally. **Recommendation**: ship Pillar 5's free static-preview-plus-deep-link scope now; revisit an embedded map if/when the product owner is willing to add billing for a maps provider.
3. **Multi-instance WebSocket scaling (Pillar 3)**: if the Render deployment is ever scaled to more than one API instance, a single in-process WebSocket fan-out (as scoped here) stops reliably delivering messages to a recipient connected to a different instance. This needs a shared pub/sub layer (e.g. a paid Redis add-on) to fix properly. **Recommendation**: ship the single-instance version now (matches the project's current single-instance Render deployment); flag this explicitly as a follow-up the moment horizontal scaling is considered, rather than paying for Redis infrastructure pre-emptively.
