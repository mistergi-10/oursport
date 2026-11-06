# Slice 9: Events depth — photo recap, ratings, group chat, "my events"

## Summary

Deepen the existing events system (slice 4, extended by slice 7's Pillar 2) with four additions: a post-event photo recap gallery, a lightweight peer-rating/reputation signal between people who shared an event, a per-event group conversation reusing the existing conversations/messages machinery, and a long-deferred "my events" filter that also becomes the discovery entry point for past events (which otherwise drop out of `GET /v1/events` once `startsAt` passes).

## Current state (verified in code)

- `server/src/db/schema.ts` already has `events`, `eventMembers` (hard-deleted on leave, unique `(eventId, userId)`), `eventWaitlist`, `conversations` (`matchId` **not** null, unique, FK to `matches` — strictly one row per match), `messages` (generic `conversationId`/`senderUserId`/`body`), and `pushSubscriptions`. There is no photo, rating, or group-chat table.
- `server/src/index.ts`'s `findConversationForParticipant` ([server/src/index.ts](../../server/src/index.ts#L1771)) hard-codes a two-participant model: it inner-joins `conversations` → `matches` and authorizes the caller via `matches.userLowId`/`userHighId`, with a left-joined `blocks` check assumed pairwise. `GET /v1/conversations` (list) and `POST/GET /v1/conversations/:id/messages` all share this same two-party assumption. The `/v1/ws` websocket ([server/src/index.ts](../../server/src/index.ts#L1115)) fans a new-message event out by looking up sockets per `userId`, which generalizes fine to more than two recipients — only the *participant-resolution* layer is 1:1-specific.
- `GET /v1/events` and `GET /v1/events/for-you` both filter `startsAt > now()` unconditionally; a past event is still fetchable by id (`GET /v1/events/:eventId`) but disappears from every list a user would normally browse — there is today no way to *discover* a past event you were part of unless you already have its id.
- `event_members` rows are hard-deleted on `POST /v1/events/:eventId/leave` ([server/src/index.ts](../../server/src/index.ts#L1372)) — once someone leaves, there is no record they were ever there.
- `profiles.photoUrl` ([server/src/db/schema.ts](../../server/src/db/schema.ts#L40)) stores a compressed base64 `data:` URI directly in Postgres, with an explicit code comment acknowledging this is a shortcut, not real object storage. The server-side `photoUrlSchema` ([server/src/index.ts](../../server/src/index.ts#L98)-[L102](../../server/src/index.ts#L102)) caps it at `350_000` characters and requires a `data:image/(png|jpeg|jpg|webp);base64,` prefix; `ProfileScreen` enforces the same `350_000`-char ceiling client-side before upload ([oursport/screens/ProfileScreen.tsx](../../oursport/screens/ProfileScreen.tsx#L83)). This is a single photo per profile — a per-event gallery is a materially different row/size-growth shape (see Decisions).
- `oursport/navigation/types.ts`'s `Conversation` route is `{ conversationId: string; name: string; userId: string }` — `userId` assumes exactly one counterpart, which a group conversation doesn't have.
- `oursport/screens/EventDetailScreen.tsx`, `Events.tsx`, `CreateEventScreen.tsx` already follow the `Button`/`Card`/`Chip`/`EmptyState`/`Skeleton` component conventions and the theme system (`oursport/theme/`) confirmed by direct reading; new UI below follows the same patterns.

**Cross-slice note:** slice 8 (`docs/requirements/08-i18n.md`) is adding app-wide i18n/translation infrastructure in parallel. All new UI copy specified below is German-only for now, same as the rest of the app, and will need to flow through that system once it lands — no i18n design is attempted in this document.

## Pillar 1 — Post-event photo recap gallery

### User stories

1. As someone who attended an event, once it's over I can upload photos from it to a shared gallery that every other attendee (past or current) can see.
2. As an attendee, I can add a short optional caption to a photo I upload.
3. As an attendee, I can browse the full gallery for an event I was part of, newest photos first.

### Data model changes

New table, additive only:

```ts
export const eventPhotos = pgTable(
  "event_photos",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    uploaderUserId: uuid("uploader_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Same compressed base64 data: URI shortcut as profiles.photoUrl — see
    // Decisions for the honest row/size-growth tradeoff of reusing it here.
    photoData: text("photo_data").notNull(),
    caption: varchar("caption", { length: 200 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("event_photos_event_created_idx").on(table.eventId, table.createdAt)],
);
```

- Also depends on the `event_members.leftAt` column added in Pillar 4 below ("attended" = has an `event_members` row for this event, regardless of whether they later left).
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only.

### API contract changes

- **New: `POST /v1/events/:eventId/photos`**
  - Body: `{ "photoData": "data:image/(png|jpeg|jpg|webp);base64,... — same regex/max-length (350_000 chars) as profiles.photoUrl", "caption": "string, trimmed, 0-200 chars, optional" }`.
  - `404` if the event doesn't exist.
  - `400` if `startsAt > now()` (`{"error": "Event hasn't happened yet"}`).
  - `403` if the caller has no `event_members` row (current or past) for this event (`{"error": "Only members who attended can upload photos"}`).
  - `400` if the event already has 40 photos (`{"error": "Photo gallery is full for this event"}`) — a fixed per-event cap, see Decisions.
  - `201`: `{ "photoId": "uuid", "eventId": "uuid", "uploaderUserId": "uuid", "uploaderName": "string", "photoData": "string", "caption": "string | null", "createdAt": "ISO-8601 string" }`.
- **New: `GET /v1/events/:eventId/photos`**
  - Query: `limit`/`cursor`, same pagination convention as other list endpoints; ordered `createdAt DESC` (newest first).
  - `404` if the event doesn't exist. `403` with the same message as above if the caller never attended.
  - `200`: `{ "photos": [ { "photoId", "uploaderUserId", "uploaderName", "photoData", "caption", "createdAt" } ], "nextCursor": "string | null" }`.

### Mobile UI/UX notes

- `EventDetailScreen` gains a "Fotos" section, rendered only when `startsAt <= now()` (client-computed, no new field needed): a horizontally scrollable thumbnail row (`Image` components, same pattern as `ProfileScreen`/`MatchesList`'s avatar images) backed by `GET /v1/events/:eventId/photos`, plus a "+"-style upload affordance reusing `expo-image-picker` with `base64: true` exactly like `ProfileScreen`'s existing photo picker, posting to `POST /v1/events/:eventId/photos`. Hidden/disabled (not just empty) for a caller who never attended.
- An inline `caption` text input (optional, 200-char cap enforced client-side) appears alongside the picker before upload.
- Tapping a thumbnail opens it full-screen (simple `Modal` + `Image`, no new dependency).

### Acceptance criteria

1. `POST /v1/events/:eventId/photos` returns `400` when `startsAt` is still in the future.
2. `POST /v1/events/:eventId/photos` returns `403` for a caller who never had an `event_members` row for that event.
3. A caller who joined and later left an event (`leftAt` set) can still upload to and view that event's gallery after it has passed.
4. `GET /v1/events/:eventId/photos` returns photos ordered newest-first with no repeated `photoId`s across paginated pages.
5. Mobile: the "Fotos" section on `EventDetailScreen` only renders for events whose `startsAt` has passed, and only offers the upload control to someone who attended.

### Out of scope

- Deleting or editing an uploaded photo (consistent with this app's existing "events/messages are immutable after creation" convention) — moderation of inappropriate photos goes through the existing `reports` flow (`reason: "inappropriate_content"`) against the uploader, not a dedicated delete endpoint.
- Real object storage (S3/Cloudinary/R2/etc.) — this pillar reuses the Postgres base64 shortcut; see Decisions for the honest tradeoff and the genuinely open question on revisiting this.
- Any upload-window cutoff after the event (uploads stay open indefinitely post-event in this MVP).
- Image compression/resizing beyond whatever the client already applies before producing the base64 string (no new server-side image processing).
- Likes/comments/reactions on individual photos.

## Pillar 2 — Rating training partners after an event

### User stories

1. As someone who attended an event, once it's over I can rate another attendee (1-5 stars, optional short comment).
2. As a user, I can see my own aggregate rating (average + count) building up over time as a lightweight reputation signal.
3. As a user, I can see the aggregate rating of people I'm considering an event with (shown next to their name in an event's attendee list).
4. As a user, I can't rate myself, can't rate someone I never shared a past event with, and can only leave one (editable) rating per person per event.

### Data model changes

New table, additive only:

```ts
export const eventRatings = pgTable(
  "event_ratings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    raterUserId: uuid("rater_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rateeUserId: uuid("ratee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stars: integer("stars").notNull(), // 1-5, enforced at the API layer (same convention as events.capacity)
    comment: varchar("comment", { length: 300 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_ratings_event_rater_ratee_unique").on(table.eventId, table.raterUserId, table.rateeUserId),
    index("event_ratings_ratee_created_idx").on(table.rateeUserId, table.createdAt),
  ],
);
```

- The unique `(eventId, raterUserId, rateeUserId)` index both makes rating idempotent (re-rating the same person for the same event updates the existing row) and is the DB-level enforcement of "one rating per rater/ratee/event".
- "Attended" (for eligibility) means "has an `event_members` row for that event, regardless of `leftAt`" — same definition as Pillar 1, reusing the Pillar 4 schema change.
- Reputation (`averageRating`/`ratingCount`) is **global** per user — aggregated across every event they've ever been rated in, not scoped to one event — since the goal is an overall reputation signal, not a per-event score.
- Requires a new Drizzle migration, additive only.

### API contract changes

- **New: `POST /v1/events/:eventId/ratings/:rateeUserId`**
  - Body: `{ "stars": "integer, 1-5", "comment": "string, trimmed, 0-300 chars, optional" }`.
  - `404` if the event doesn't exist.
  - `400` if `startsAt > now()` (`{"error": "Event hasn't happened yet"}`).
  - `400` if `rateeUserId === caller` (`{"error": "Cannot rate yourself"}`).
  - `403` if either the caller or the ratee lacks an `event_members` row (current or past) for this event — one generic message either way (`{"error": "Both must have attended this event to rate"}`), so the response doesn't leak which side failed.
  - Upserts on `(eventId, raterUserId, rateeUserId)` (`onConflictDoUpdate`, updating `stars`/`comment`/`updatedAt`) — submitting again changes your existing rating rather than erroring or duplicating.
  - `200`: `{ "eventId": "uuid", "rateeUserId": "uuid", "stars": number, "comment": "string | null", "createdAt": "ISO-8601 string", "updatedAt": "ISO-8601 string" }`.
- **New: `GET /v1/users/me/ratings`** — ratings *received* by the caller, private to them.
  - Query: `limit`/`cursor`, same convention; ordered `createdAt DESC`.
  - `200`: `{ "summary": { "averageRating": "number | null", "ratingCount": "number" }, "ratings": [ { "ratingId", "eventId", "eventTitle", "raterUserId", "raterName", "stars", "comment", "createdAt" } ], "nextCursor": "string | null" }`. `summary` is computed independently of the current page (a full aggregate, not derived from the returned slice).
- **Changed: `GET /v1/events/:eventId`** — each entry in `attendees` gains `leftAt: "ISO-8601 string | null"`, `averageRating: "number | null"`, `ratingCount: "number"`, and `canRate: "boolean"` (`true` iff the event has passed, the caller themselves attended, and the attendee isn't the caller). For an event that hasn't happened yet, `attendees` is unchanged (current members only, `leftAt` always `null`); for a past event, `attendees` includes everyone who was *ever* a member (so there's someone to rate even if they later left), ordered `joinedAt ASC` as today.

### Mobile UI/UX notes

- `EventDetailScreen`'s existing "Teilnehmer" list gains, next to each attendee's name: their `averageRating`/`ratingCount` (e.g. a small star icon + "4.5 (12)", reusing `Ionicons` already imported, no new icon dependency) and, when `canRate` is true, a tappable 5-star row (`Ionicons` `star`/`star-outline`) plus an optional comment `TextInput`, submitting to `POST /v1/events/:eventId/ratings/:rateeUserId`.
- `ProfileScreen` gains a small "Deine Bewertungen" read-only section showing the caller's own `summary.averageRating`/`ratingCount` from `GET /v1/users/me/ratings` (first page only needed for the summary numbers; the list itself isn't necessarily rendered in this MVP — see Out of scope).

### Acceptance criteria

1. `POST /v1/events/:eventId/ratings/:rateeUserId` returns `400` for a future event, `400` for self-rating, and `403` when the caller or ratee never attended that event.
2. Submitting a rating twice for the same `(eventId, rateeUserId)` updates the existing row (one row in `event_ratings`, not two) and the latest `stars`/`comment` win.
3. `GET /v1/users/me/ratings`'s `summary.averageRating`/`ratingCount` reflect all ratings ever received by the caller, across every event, not just the current page.
4. `GET /v1/events/:eventId` on a past event includes attendees who have since left (`leftAt` non-null), each with `canRate: true` for the caller if the caller also attended.
5. Mobile: the rating control only renders for attendees of a past event the caller also attended, never for the caller's own row.

### Out of scope

- Public, per-event visible ratings/reviews — comments are private to the ratee (surfaced only via `GET /v1/users/me/ratings`); only the numeric aggregate is shown to others. This is a deliberate anti-harassment choice (see Decisions).
- Anonymous ratings — the rater's identity is always visible to the ratee via `raterUserId`/`raterName`, consistent with this app's existing non-anonymous `reports` model.
- A dedicated "ratings received" screen/list UI beyond the `ProfileScreen` summary numbers (the `GET /v1/users/me/ratings` list endpoint exists and is paginated, ready for a future slice to build a full screen on top of).
- Any push/websocket notification when a new rating arrives.
- Editing/deleting a rating via a dedicated "delete" action (re-submitting overwrites; there's no way to fully remove a rating in this MVP).
- Any automated fraud/collusion detection (e.g. mutual 5-star rating rings) — out of scope for this slice.

## Pillar 3 — Per-event group chat

### User stories

1. As a current member of an event, I can post messages in a group conversation shared with every other current member.
2. As a current member, I can read the full message history of that event's group chat, including messages sent before I joined.
3. As someone who has left an event, I no longer have access to its group chat.

### Data model changes

One changed table (nullable column added, backward compatible), no new table — the existing `conversations`/`messages` tables are reused directly:

```ts
// conversations gains a nullable eventId so the same table backs both 1:1
// match conversations and per-event group conversations. matchId becomes
// nullable to make room for eventId; exactly one of the two is set per row
// (enforced at the application layer only, same convention as events.capacity
// — no DB CHECK constraint, consistent with this project's existing style).
export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchId: uuid("match_id").unique().references(() => matches.id, { onDelete: "cascade" }), // now nullable
  eventId: uuid("event_id").unique().references(() => events.id, { onDelete: "cascade" }), // new, nullable
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
```

- `messages` is unchanged — `conversationId` already points at any `conversations` row regardless of kind.
- Requires a new Drizzle migration altering the existing `conversations` table (drop the `NOT NULL` on `matchId`, add nullable unique `eventId`), additive/backward-compatible — existing rows keep `matchId` set and `eventId` null.

### API contract changes

- **Changed: `POST /v1/events`** — in the same transaction that inserts the `events` row and the creator's `event_members` row, also inserts a `conversations` row with `eventId` set to the new event's id (mirrors how a match's `conversations` row is created in the same transaction as the match today).
- **Changed: `GET /v1/events/:eventId`** — response gains `conversationId: "uuid"` (always present, since every event gets one at creation time).
- **Changed (participant-resolution generalization, same response shapes): `GET /v1/conversations/:conversationId/messages`, `POST /v1/conversations/:conversationId/messages`, `POST /v1/conversations/:conversationId/read`** — the authorization check (`findConversationForParticipant`) is generalized: for a `conversations` row with `eventId` set, the caller is authorized iff they currently have an `event_members` row for that event with `leftAt IS NULL` (vs. the existing match-pair check for `matchId`-based rows). The `blocks` check in this path is **not** applied to event-based conversations in this slice (see Out of scope).
- **Changed: message response shape** — both the `GET` list and the `POST` create response for `.../messages` gain `senderName: "string"` per message (a join against `profiles` the server already has easy access to), needed so a group chat with more than two participants can label who sent what; harmless additive field for existing 1:1 conversations.
- **Changed (server-internal, no client-visible contract change): `/v1/ws` broadcast** — when a new message is posted to an event-based conversation, the server fans the `{"type":"message",...}` event out to the sockets of every current (`leftAt IS NULL`) `event_members` row for that event, instead of the two match participants.
- **Unchanged:** `GET /v1/conversations` (the Chats-tab list) and `GET /v1/matches` — event conversations are intentionally not surfaced there in this slice (see Out of scope); they're reached only via the event detail screen.

### Mobile UI/UX notes

- `oursport/navigation/types.ts`'s `Conversation` route changes from `{ conversationId: string; name: string; userId: string }` to `{ conversationId: string; name: string; userId?: string; isGroup?: boolean }` — `userId` becomes optional (no single counterpart in a group chat) and a new `isGroup` flag tells `ConversationScreen` to render a sender name label above/alongside each bubble (using the new `senderName` field) instead of assuming exactly two sides.
- `EventDetailScreen` gains a "Zum Event-Chat" button (visible to any caller with a current `event_members` row for that event, i.e. `isAttending` true) navigating to `Conversation` with `{ conversationId: event.conversationId, name: event.title, isGroup: true }` — reusing the existing screen rather than building a new one.
- No changes to `MatchesList`/the Chats tab — event group chats aren't listed there in this slice.

### Acceptance criteria

1. `POST /v1/events` creates exactly one `conversations` row (with `eventId` set) alongside the event itself.
2. A current member of an event can post to and read `GET/POST /v1/conversations/:conversationId/messages` for that event's `conversationId`; someone who has left (`leftAt` set) gets the same 404-style denial as a non-participant does today on a match conversation.
3. A message posted in an event's group chat is delivered over `/v1/ws` to every other currently-connected current member, not just two parties.
4. Existing 1:1 match conversations continue to work unchanged (no regression from making `matchId` nullable).
5. Mobile: `ConversationScreen` in group mode (`isGroup: true`) shows a sender name per message; in 1:1 mode it behaves exactly as before.

### Out of scope

- Surfacing event group conversations in the main Chats tab list (`GET /v1/conversations`/`MatchesList`) — reachable only from `EventDetailScreen` in this slice.
- Applying the `blocks` system to group event chats — a blocked/blocking pair can still see each other's messages within a shared event's group chat; generalizing pairwise blocking to an N-party room (hide only their messages? block posting entirely? kick from the room?) is a real design question deferred to a future slice.
- Typing indicators, read receipts shown per-member (the existing single-row-per-(conversation,user) `conversation_reads` mechanism is reused as-is but its UI, if any, isn't extended for "seen by N of M" in this slice).
- Leaving/re-joining notifications inside the chat itself (e.g. a system message "X left the event").
- A dedicated group-chat-specific screen distinct from the existing `ConversationScreen`.

## Pillar 4 — "My events" filter/view

### User stories

1. As a user, I can filter the Events tab to show only events I created or am currently attending, instead of scrolling the full list.
2. As a user, I can browse a separate "past events" view of events I was part of (created or attended, even if I've since left), since those otherwise vanish from the normal list once they start.

### Data model changes

One changed table (nullable column added, backward compatible):

```ts
// event_members gains a nullable leftAt column (soft delete instead of hard
// delete) so historical membership survives a user leaving — needed by
// Pillars 1-2 above, which must still recognize someone who attended a past
// event even after they later tap "leave", and by this pillar's past-events view.
export const eventMembers = pgTable(
  "event_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }), // null while currently attending
  },
  (table) => [
    uniqueIndex("event_members_event_user_unique").on(table.eventId, table.userId),
    index("event_members_user_idx").on(table.userId),
  ],
);
```

- **Behavior change to the already-shipped `POST /v1/events/:eventId/leave`:** it now sets `leftAt = now()` on the existing row instead of deleting it. Re-joining (`POST /v1/events/:eventId/join`) after a prior leave upserts the same row: `leftAt` reset to `null`, `joinedAt` reset to `now()` (the unique `(eventId, userId)` index means a second insert would otherwise conflict).
- `attendeeCount`/`spotsLeft`/`isAttending` everywhere (list, detail, join/leave responses) are redefined as `COUNT(*) WHERE eventId = ... AND leftAt IS NULL` — numerically identical to today's hard-delete behavior, just computed over soft-deleted rows instead of absent ones.
- Requires a new Drizzle migration (nullable column add), additive/backward-compatible.

### API contract changes

- **Changed: `GET /v1/events`** — gains two optional query params:
  - `mine` (literal `"true"`, optional): restricts results to events where the caller `isCreator` or currently attends (`event_members` row with `leftAt IS NULL`).
  - `when` (`"upcoming"` default | `"past"`, optional; `when=past` without `mine=true` is `400` — `{"error": "when=past requires mine=true"}`, since general past-event browsing isn't in scope, only "my" past events are).
  - `mine=true&when=upcoming` (or `mine=true` alone): same future-only (`startsAt > now()`) filter and soonest-first ordering as today, narrowed to the caller's own events.
  - `mine=true&when=past`: `startsAt <= now()` AND (`isCreator` OR the caller has *any* `event_members` row for the event, regardless of `leftAt`) — so an event you've since left still shows up here, since you may still want to view its photos/ratings. Ordered `startsAt DESC` (most recent first), keyset-paginated the same way (`startsAt`, `id`).
  - Without `mine`, behavior is completely unchanged — no general public past-event browsing is added.

### Mobile UI/UX notes

- `Events` tab gains a small segmented filter row (reusing `Chip`, same row style as the existing sport-filter chips): "Alle" (default/current behavior) / "Meine" (`mine=true`) / "Vergangene" (`mine=true&when=past`), sitting alongside the existing search box and sport chips (all filters combine, consistent with existing AND semantics).
- The "Vergangene" view is the practical entry point into Pillars 1-2: tapping a past event navigates to the existing `EventDetailScreen`, which now conditionally renders the photo gallery and rating controls because `startsAt <= now()`.

### Acceptance criteria

1. `GET /v1/events?mine=true` returns only future events the caller created or currently attends.
2. `GET /v1/events?mine=true&when=past` returns only past events the caller created or was ever a member of (including ones they've since left), newest-first.
3. `GET /v1/events?when=past` (without `mine=true`) returns `400`.
4. Re-joining a previously-left event via `POST /v1/events/:eventId/join` succeeds (no unique-constraint error) and resets `isAttending` to `true`.
5. Mobile: the "Meine"/"Vergangene" chips correctly scope the visible list, and a past event opened from "Vergangene" shows the Pillar 1/2 sections described above.

### Out of scope

- General (non-"mine") browsing of past events — `GET /v1/events` without `mine=true` still only ever returns future events.
- Any change to `GET /v1/events/for-you` (unaffected by `mine`/`when`).
- A distinct "My events" screen separate from the existing `Events` tab (implemented as filter chips on the same screen, not a new tab/screen).

## Decisions

Per this project's established convention (product owner pre-approves the maximal in-house-feasible option), the following are decided rather than left open:

1. **Photo storage (Pillar 1)**: reuse the existing Postgres base64 `data:` URI shortcut (`profiles.photoUrl`'s approach), capped at the same 350,000-character per-photo limit, plus a new fixed 40-photos-per-event cap to bound total row/size growth for a feature that (unlike one profile photo) accumulates many rows per event. This is an honest shortcut, not real object storage: a popular event with 40 max-sized photos adds roughly 14 MB to the `event_photos` table alone, and Postgres TOAST storage handles large column values reasonably well for this project's current scale, but this does not scale to "unlimited photos" or large user growth. Real object storage (S3/Cloudinary/R2) would remove this ceiling entirely but requires provisioning and paying for an external provider this project has no credentials for today — same class of blocker as native push (slice 7, Pillar 4) and paid maps (slice 7, Pillar 5). Per this project's "ship the free/in-house-feasible option now, document the gap" convention, this slice ships the Postgres shortcut with a hard per-event cap and documents the tradeoff rather than blocking on new infrastructure.
2. **Ratings visibility (Pillar 2)**: approved as aggregate-public / comment-private — average rating + count are visible to other users (next to an attendee's name), but individual comments are visible only to the ratee (via `GET /v1/users/me/ratings`). This limits the feature's harassment surface (no public "bad review" wall) while still delivering the requested "lightweight reputation signal", consistent with this app's existing safety posture (blocks, reports).
3. **Rating anti-abuse rules (Pillar 2)**: approved as specified — no self-rating, rater and ratee must each have an `event_members` row (current or past) for the same event, one rating per `(event, rater, ratee)` that's editable (upsert) rather than erroring on a second submission, rater identity always visible to the ratee (not anonymous).
4. **Group chat reuses `conversations`/`messages` (Pillar 3)**: approved — `conversations.matchId` becomes nullable and a nullable unique `eventId` is added, with participant authorization generalized to accept either a match pair or current event membership. This was chosen over a parallel schema because `messages` already generalizes cleanly (no 1:1 assumption in that table at all), and the only genuinely 1:1-specific logic was the participant-resolution query, which is a contained, documented change.
5. **Event chat excluded from the main Chats list (Pillar 3)**: approved to keep this slice's scope contained — event conversations are reachable only from `EventDetailScreen`. Merging them into one unified "all my conversations" list is a reasonable follow-up, not required now.
6. **`event_members.leftAt` soft delete (Pillar 4)**: approved — changes the already-shipped leave endpoint's storage behavior (soft delete instead of hard delete) because Pillars 1 and 2 both need to recognize someone who attended a past event even after they've since left it. `attendeeCount`/`spotsLeft`/`isAttending` semantics are unchanged (still computed from "currently a member" rows); only the storage mechanism changes.
7. **"My events" past-event membership definition (Pillar 4)**: approved — `mine=true&when=upcoming` requires *current* membership (consistent with `isAttending` elsewhere), while `mine=true&when=past` includes anyone who was *ever* a member (including those who've since left), since the point of the past view is enabling access to Pillars 1-2, which themselves use the "ever attended" definition.

### Genuinely open questions

1. **Real object storage for event photos**: if gallery adoption grows meaningfully (many events, each near the 40-photo cap), the Postgres-shortcut approach from Decision 1 will start showing real costs (table/backup size, query latency on large TOAST reads). Revisiting this requires picking and paying for an external object-storage provider (S3, Cloudinary, Cloudflare R2, etc.) — a budget/vendor decision this document can't make unilaterally. **Recommendation**: ship the in-house shortcut now (as decided above); revisit object storage if/when gallery usage or infra cost data justifies it.
