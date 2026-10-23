# Slice 4: Events and event membership

## Summary

Let any authenticated user create a sport event (title, sport, city, date/time, optional description, capacity) and let other users browse upcoming events filtered by city/sport, join or leave one, and see who else is attending — replacing the hardcoded placeholder list in the `Events` tab with real data.

## Current state (verified in code)

- `server/src/db/schema.ts` has `users`, `profiles`, `password_reset_codes`, `swipes`, `matches`, `conversations`, `messages`. There is no event or event-membership table.
- `server/src/index.ts` exposes the slice 1–3 routes (auth/profile, `GET /v1/discover`, `POST /v1/swipes`, `GET /v1/matches`, `GET /v1/conversations`, conversation message routes), all resolving the acting user via `resolveUserId(subject, userId, tokenVersion)` after `authenticate(request.headers)`. There are no `/v1/events*` routes. Existing list endpoints share a keyset-pagination convention (`paginationQuerySchema` with `limit`/`cursor`, `encodeCursor`/`decodeCursor` helpers at [server/src/index.ts](../../server/src/index.ts#L84)), and the mutual-match path in `POST /v1/swipes` shows the project's pattern for capacity/race-safety: a `pg_advisory_xact_lock(hashtext(...))` inside a `database.transaction(...)` before the conflicting insert ([server/src/index.ts](../../server/src/index.ts#L484)).
- `oursport/App.tsx`'s `Events` component ([oursport/App.tsx](../../oursport/App.tsx#L1304)) is a static placeholder: it renders a hardcoded array of three `["day", "month", "title", "meta"]` tuples, a fixed `"● ● +3"` attendee-count string, and a `Pressable` "Beitreten" button with no `onPress` handler (`styles.join`/`styles.joinText`, not wired to any API call).
- `MainTabParamList` ([oursport/App.tsx](../../oursport/App.tsx#L78)) already has an `Events: undefined` tab entry; `RootStackParamList` ([oursport/App.tsx](../../oursport/App.tsx#L69)) has no `CreateEvent` or `EventDetail` screen.
- The `sports` constant ([oursport/App.tsx](../../oursport/App.tsx#L104)) is the fixed, German-language sport list (`Laufen`, `Tennis`, `Klettern`, `Yoga`, `Fussball`, `Radfahren`) already used as the chip picker on the profile/signup form and matching `profiles.sport` (`varchar(40)`); events should reuse the same list/field shape rather than introduce a separate sport taxonomy.
- No date/time picker library (e.g. `@react-native-community/datetimepicker`) is currently a dependency of `oursport/package.json`.

## User stories

1. As a user, I can create a sport event with a title, sport, city, date/time, optional description, and a capacity, and I'm automatically counted as its first attendee.
2. As a user, I can browse a list of upcoming events, optionally filtered by city and/or sport, so I can find something relevant to join.
3. As a user, I can view an event's full details, including how many spots are left and who is already attending.
4. As a user, I can join an event that isn't full yet, and leave an event I've joined, from both the list and the detail view.
5. As a user, I cannot join an event that's already at capacity, and I'm told it's full.

## Data model changes

`server/src/db/schema.ts` — two new tables:

```ts
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creatorUserId: uuid("creator_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 120 }).notNull(),
    sport: varchar("sport", { length: 40 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    description: varchar("description", { length: 1000 }),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("events_sport_city_starts_idx").on(table.sport, table.city, table.startsAt),
    index("events_starts_at_idx").on(table.startsAt),
  ],
);

export const eventMembers = pgTable(
  "event_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("event_members_event_user_unique").on(table.eventId, table.userId),
    index("event_members_user_idx").on(table.userId),
  ],
);
```

- `event_members` is the membership/attendance table; its unique `(eventId, userId)` index makes joining idempotent and gives `COUNT(*) WHERE eventId = ...` as the attendee count.
- The creator is inserted as an `event_members` row in the same transaction as the `events` insert, so "attendee count" always includes the creator with no special-cased union logic in queries.
- `events.capacity` is the hard cap on `event_members` rows for that event (enforced at the API layer, see below) — no waitlist table.
- `events.description` is nullable (matches the "optional description" requirement); `events.city`/`events.sport` reuse the same length limits as `profiles.city`/`profiles.sport` for consistency.
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only — no changes to existing tables.

## API contract

All routes require the existing Bearer-JWT / dev `X-User-Id` auth and resolve the acting user via `resolveUserId`. Events are not private: any authenticated user can list/view any event (there's no per-event visibility restriction in this slice).

### New: `POST /v1/events`

- Body:
  ```json
  {
    "title": "string, trimmed, 1-120 chars",
    "sport": "string, trimmed, 1-40 chars",
    "city": "string, trimmed, 1-120 chars",
    "startsAt": "ISO-8601 string, must be strictly in the future",
    "description": "string, trimmed, 0-1000 chars, optional",
    "capacity": "integer, 2-100"
  }
  ```
- Behavior: inserts the `events` row with `creatorUserId = caller`, then inserts an `event_members` row for `(eventId, caller)` in the same transaction.
- Response `201`: the event detail shape (see `GET /v1/events/:eventId` below), with `attendeeCount: 1`, `spotsLeft: capacity - 1`, `isAttending: true`, `isCreator: true`.
- `400` for any validation failure (e.g. `startsAt` not in the future, `capacity` out of range, blank `title`/`city`/`sport`).

### New: `GET /v1/events`

- Query params: `city` (optional, trimmed string, exact case-insensitive match), `sport` (optional, trimmed string, exact case-insensitive match), `limit` (optional, default 20, max 50), `cursor` (optional, opaque string) — same pagination convention as the other list endpoints, but ordered soonest-first.
- Behavior: returns events where `startsAt > now()`, optionally filtered by `city`/`sport`, ordered by `startsAt ASC, id ASC` (soonest event first), keyset-paginated on that same `(startsAt, id)` pair.
- Response `200`:
  ```json
  {
    "events": [
      {
        "eventId": "uuid",
        "title": "string",
        "sport": "string",
        "city": "string",
        "startsAt": "ISO-8601 string",
        "description": "string | null",
        "capacity": "number",
        "attendeeCount": "number",
        "spotsLeft": "number",
        "isAttending": "boolean",
        "isCreator": "boolean",
        "creatorUserId": "uuid",
        "creatorName": "string"
      }
    ],
    "nextCursor": "string | null"
  }
  ```

### New: `GET /v1/events/:eventId`

- Path param: `eventId` (uuid).
- Behavior: returns the full event detail plus the attendee list (so users can see who's attending).
- Response `200`:
  ```json
  {
    "eventId": "uuid",
    "title": "string",
    "sport": "string",
    "city": "string",
    "startsAt": "ISO-8601 string",
    "description": "string | null",
    "capacity": "number",
    "attendeeCount": "number",
    "spotsLeft": "number",
    "isAttending": "boolean",
    "isCreator": "boolean",
    "creatorUserId": "uuid",
    "creatorName": "string",
    "attendees": [
      { "userId": "uuid", "name": "string" }
    ]
  }
  ```
- `attendees` is ordered by `joinedAt ASC` (creator first, since they're joined in the creation transaction).
- `404` if `eventId` doesn't exist.

### New: `POST /v1/events/:eventId/join`

- Path param: `eventId` (uuid). No body.
- Behavior, inside a transaction guarded by `pg_advisory_xact_lock(hashtext(eventId))` (same pattern as the swipe/match path) to avoid a capacity race between two near-simultaneous joins:
  - `404` if the event doesn't exist.
  - `400` if `startsAt <= now()` (event already started/passed — can't join a past event).
  - If the caller is already an `event_members` row for this event (including the creator), this is a no-op: return `200` with the current event state (idempotent — a retried tap doesn't error).
  - Else if `attendeeCount >= capacity`, return `409` (`{"error": "Event is full"}`).
  - Else insert the `event_members` row and return `200` with the updated event state (same shape as `GET /v1/events/:eventId`, minus `attendees`).

### New: `POST /v1/events/:eventId/leave`

- Path param: `eventId` (uuid). No body.
- Behavior:
  - `404` if the event doesn't exist.
  - `400` if the caller is the event's creator (`{"error": "Creator cannot leave their own event"}`) — this MVP has no event cancellation/ownership-transfer flow, so the creator is permanently a member of their own event.
  - If the caller isn't currently a member, this is a no-op: return `200` with the current event state.
  - Else delete the caller's `event_members` row and return `200` with the updated event state (same shape as `GET /v1/events/:eventId`, minus `attendees`).

## Mobile UI/UX notes (`oursport/App.tsx`)

- `Events` tab component: replace the hardcoded tuple array with a real fetch from `GET /v1/events`. Add a simple filter row above the list — a city text input and a sport chip row reusing the existing `sports` constant (plus an "Alle" chip to clear the filter) — that re-queries on change.
- Each event row keeps the existing date-badge layout (day/month derived from `startsAt`), shows `title` and a meta line (`time · city`), and replaces the static `"● ● +3"` with the real `attendeeCount`/`spotsLeft`. The `Beitreten` button becomes functional: it calls `POST /v1/events/:eventId/join` and flips to a `Dabei ✓` / "Verlassen" affordance calling `POST /v1/events/:eventId/leave` once `isAttending` is true, with an optimistic update to `attendeeCount`/`spotsLeft` and rollback on request failure (mirroring the inline error-text pattern used elsewhere, e.g. `Matching`). The button is disabled (with "Ausgebucht" copy) when `spotsLeft === 0` and `isAttending` is false.
- Tapping a row navigates to a new `EventDetail` screen (new `RootStackParamList` entry: `{ eventId: string }`), pushed as a native-stack screen on top of the tab bar. It shows the full description, date/time, capacity/spots left, creator name, the attendee list (`name` per row), and the same join/leave control as the list row.
- Add a "+" header action on the `Events` tab that opens a new `CreateEvent` screen (new `RootStackParamList` entry, no params) with a form: `title` (text input), `sport` (chip picker reusing `sports`, same pattern as the profile/signup form), `city` (text input, prefilled from the caller's own `profiles.city`), date and time, `description` (optional, multiline), `capacity` (numeric input, 2–100). On submit, `POST /v1/events`, then navigate back to the `Events` tab and refetch so the new event appears.
- **Date/time input (decision):** since no date/time picker library is currently installed, this MVP uses plain text inputs for date (`YYYY-MM-DD`) and time (`HH:mm`), combined client-side into an ISO `startsAt` and validated to be in the future before submit, instead of pulling in a new native dependency. A proper native date/time picker is a reasonable low-risk follow-up but is left out of this slice's scope (see open question 1).

## Acceptance criteria

1. `POST /v1/events` with a valid body creates an `events` row and an `event_members` row for the creator in the same request; the response reports `attendeeCount: 1`, `isAttending: true`, `isCreator: true`.
2. `POST /v1/events` returns `400` for a blank `title`/`city`/`sport`, a `startsAt` that isn't strictly in the future, or a `capacity` outside `2–100`.
3. `GET /v1/events` only returns events with `startsAt` in the future, ordered soonest-first, and supports `city`/`sport` filters (case-insensitive exact match) with no repeated `eventId`s across paginated pages.
4. `GET /v1/events/:eventId` returns `404` for a non-existent `eventId`, and otherwise returns the event detail plus an `attendees` list that includes every current `event_members` row for that event (creator included).
5. `POST /v1/events/:eventId/join` returns `409` when `attendeeCount >= capacity` and the caller isn't already a member, and does not create a duplicate `event_members` row under concurrent simultaneous join attempts for the last open spot (only one succeeds).
6. `POST /v1/events/:eventId/join` is idempotent: calling it again after already joining (or as the creator) returns `200` without creating a duplicate membership row or double-counting `attendeeCount`.
7. `POST /v1/events/:eventId/join` returns `400` when `startsAt` is in the past.
8. `POST /v1/events/:eventId/leave` returns `400` when called by the event's creator, and is idempotent (`200`, no error) when called by someone who isn't currently a member.
9. After a successful join/leave, `attendeeCount`/`spotsLeft` returned by `GET /v1/events`, `GET /v1/events/:eventId`, and the join/leave response itself are mutually consistent (no stale cache).
10. Mobile: the `Events` tab shows real upcoming events from the API (not the hardcoded placeholder array), supports filtering by city and/or sport, and the join/leave button reflects `isAttending` and disables with "Ausgebucht" copy when full.
11. Mobile: creating an event via the new `CreateEvent` screen results in that event appearing in the `Events` tab list afterward.
12. Mobile: the `EventDetail` screen lists every current attendee's name.

## Out of scope

- Recurring/repeating events.
- Payments or paid events.
- Event chat (a future slice could reuse the slice 3 conversations/messages model, keyed by event instead of match).
- Editing or cancelling an event after creation (title/date/capacity/description are immutable in this MVP; the creator also cannot delete the event).
- Capacity waitlists — joining a full event is simply blocked (`409`), nothing queues for a freed-up spot.
- Creator leaving or transferring ownership of their own event.
- Geo-distance-based discovery/sorting — filtering is exact city-name match only, not radius/proximity.
- Push notifications or reminders for upcoming/joined events.
- Event images/cover photos.
- Private or invite-only events (all events are visible to every authenticated user).
- A native date/time picker UI component (plain text date/time inputs for this slice; see open question 1).

## Open questions

1. **Date/time input UX** — this doc proposes plain `YYYY-MM-DD` / `HH:mm` text inputs to avoid adding a new native dependency (`@react-native-community/datetimepicker` or similar) in this slice. Confirm that's acceptable for MVP, or approve adding the dependency now instead.
2. **Venue/meeting-point field** — the current placeholder UI shows a venue string (e.g. "Rheinufer Kleinbasel") in addition to city, but the roadmap item only lists title/sport/city/date-time/description/capacity. This doc does **not** add a separate venue field — `description` is the only free-text field besides `city` for that detail. Confirm this is sufficient, or should a short optional `venue`/`meetingPoint` varchar field be added to `events`?
3. **Capacity bounds** — this doc proposes `capacity` must be `2–100`. Confirm these bounds (in particular whether solo/`1`-person "placeholder" events should be allowed, and whether 100 is a reasonable upper limit) or specify different ones.
4. **"My events" view** — this slice has no dedicated endpoint/screen for "events I created" or "events I've joined" beyond what's visible via `isAttending`/`isCreator` flags on the general list. Confirm that's sufficient for this slice, or should a `mine=true` filter on `GET /v1/events` be added now?
5. **Creator leaving entirely blocked** — since there's no cancellation flow yet, a created event can never be un-joined by its creator and will simply age out once `startsAt` passes (and no longer appear in `GET /v1/events`, though it remains fetchable via `GET /v1/events/:eventId`). Confirm this permanent-commitment behavior is acceptable for MVP.
