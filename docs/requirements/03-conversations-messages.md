# Slice 3: Conversations and messages

## Summary

Give every match a 1:1 conversation and let matched users send and read text messages in it, replacing the disabled "Chat folgt bald" rows in the `Chats` tab with a real, polling-based message list and a last-message preview per match.

## Current state (verified in code)

- `server/src/db/schema.ts` has `users`, `profiles`, `password_reset_codes`, `swipes`, `matches`. There is no conversation or message table.
- `server/src/index.ts` exposes `GET /v1/discover`, `POST /v1/swipes`, `GET /v1/matches` (plus the slice-1 auth/profile routes), all resolving the acting user via `resolveUserId(subject, userId, tokenVersion)`. `POST /v1/swipes` creates a `matches` row inside a `pg_advisory_xact_lock`-guarded transaction when a mutual like completes ([server/src/index.ts](../../server/src/index.ts#L433)). No conversation/message routes exist.
- `oursport/App.tsx`'s `MatchesList` component ([oursport/App.tsx](../../oursport/App.tsx#L977)) renders the `Chats` tab: it fetches `GET /v1/matches`, lists each match's name/city/sport, and renders a disabled `Text` reading "Chat folgt bald" in place of a last-message preview or tap action ([oursport/App.tsx](../../oursport/App.tsx#L1056)). Rows are not `Pressable`.
- The match overlay in `MainTabs` ([oursport/App.tsx](../../oursport/App.tsx#L749)) shows "Es ist ein Match!" with a "Match ansehen" button that navigates to `Main` → `Chats`; it does not carry a conversation reference.
- `RootStackParamList` ([oursport/App.tsx](../../oursport/App.tsx#L58)) has no screen for viewing a single conversation; `MainTabParamList`'s `Chats` tab only renders the list.

## User stories

1. As a matched user, I can open a match from the Chats tab and see our conversation's message history.
2. As a matched user, I can send a text message to my match and see it appear in the conversation.
3. As a matched user, I can see new messages my match sent without having to manually refresh (polling is acceptable).
4. As a matched user, my Chats tab shows each match with a preview of the last message (or an indicator that no message has been sent yet), so I know which conversations need attention.

## Data model changes

`server/src/db/schema.ts` — two new tables:

```ts
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    matchId: uuid("match_id")
      .notNull()
      .unique()
      .references(() => matches.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: varchar("body", { length: 2000 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(table.conversationId, table.createdAt),
  ],
);
```

- `conversations.matchId` is `unique` so there is always exactly one conversation per match (1:1), and deleting a match cascades to its conversation and messages.
- **Conversation creation point (decision, see open question 1):** the conversation is created in the same transaction as the `matches` row, inside `POST /v1/swipes` — not lazily on first message. This keeps "one conversation per match" an invariant the `GET /v1/conversations` endpoint can rely on without a fallback "match with no conversation yet" case, matching the existing transactional pattern already used for match creation.
- `messages.body` is limited to 2000 chars at the Zod layer; empty/whitespace-only bodies are rejected (`400`).
- Requires a new Drizzle migration (`npm run db:generate` / `db:migrate`), additive only — no changes to existing tables.

## API contract

All routes require the existing Bearer-JWT / dev `X-User-Id` auth and resolve the acting user via `resolveUserId`. Every conversation route additionally checks the caller is one of the two users in the conversation's underlying match (`404` if the conversation doesn't exist or the caller isn't a participant — not `403`, to avoid confirming a conversation's existence to a non-participant).

### Changed: `POST /v1/swipes`

- No request/response shape change. When a mutual like completes a match, also insert a `conversations` row for that `matchId` (`onConflictDoNothing` on the unique `matchId`) inside the same transaction as the `matches` insert.

### New: `GET /v1/conversations`

- Query params: `limit` (optional, default 20, max 50), `cursor` (optional, opaque string) — same pagination convention as `GET /v1/matches`.
- Behavior: returns every conversation involving the caller, joined with the other participant's profile and the most recent message (if any). Ordered by `COALESCE(lastMessage.createdAt, conversation.createdAt) DESC`, so conversations with recent activity float to the top and untouched ones sort by when the match/conversation was created.
- Response `200`:
  ```json
  {
    "conversations": [
      {
        "conversationId": "uuid",
        "matchId": "uuid",
        "userId": "uuid",
        "name": "string",
        "city": "string",
        "sport": "string",
        "lastMessage": {
          "body": "string",
          "senderUserId": "uuid",
          "createdAt": "ISO-8601 string"
        } | null,
        "updatedAt": "ISO-8601 string"
      }
    ],
    "nextCursor": "string | null"
  }
  ```
- This endpoint replaces `GET /v1/matches` as the data source for the Chats tab. `GET /v1/matches` itself is unchanged and kept as-is (still usable elsewhere, e.g. a future "who have I matched with" view).

### New: `GET /v1/conversations/:conversationId/messages`

- Path param: `conversationId` (uuid).
- Query params: `limit` (optional, default 30, max 100), `cursor` (optional, opaque string).
- Behavior: returns messages for the conversation, newest first, keyset-paginated by `(createdAt, id)` — same cursor convention as the other list endpoints. The mobile client reverses the page for oldest-at-top display.
- Response `200`:
  ```json
  {
    "messages": [
      { "messageId": "uuid", "senderUserId": "uuid", "body": "string", "createdAt": "ISO-8601 string" }
    ],
    "nextCursor": "string | null"
  }
  ```
- `404` if `conversationId` doesn't exist or the caller isn't a participant.

### New: `POST /v1/conversations/:conversationId/messages`

- Path param: `conversationId` (uuid).
- Body: `{ "body": "string" }` — trimmed, 1–2000 chars (`400` otherwise).
- Behavior: inserts a `messages` row with `senderUserId = caller`.
- Response `201`:
  ```json
  { "messageId": "uuid", "senderUserId": "uuid", "body": "string", "createdAt": "ISO-8601 string" }
  ```
- `404` if `conversationId` doesn't exist or the caller isn't a participant.

## Mobile UI/UX notes (`oursport/App.tsx`)

- `MatchesList` (the `Chats` tab component): switch its fetch from `GET /v1/matches` to `GET /v1/conversations`. Each row becomes `Pressable`, shows `lastMessage.body` truncated to one line as the preview (or "Sag Hallo 👋" style placeholder copy when `lastMessage` is `null`), and a relative time derived from `updatedAt` instead of the static "Chat folgt bald" text. Tapping a row navigates to a new `Conversation` screen.
- Add a `Conversation` screen to `RootStackParamList` (pushed as a native-stack screen on top of the tab bar, params: `{ conversationId: string; name: string }`), not a new bottom tab. It renders:
  - A header with the other participant's `name` (passed as a nav param so it's available before any message loads).
  - A scrollable message list, own messages right-aligned with the `C.ember`/`C.volt` accent, the other participant's left-aligned, each showing `body` and a short time label.
  - A text input + send button pinned to the bottom; sending calls `POST /v1/conversations/:id/messages`, optimistically appends the message locally, and clears the input. A failed send keeps the text in the input and shows the existing inline error-text pattern used in `Matching`.
  - Polling: while the screen is focused (`useFocusEffect`), poll `GET /v1/conversations/:id/messages` on an interval (proposed: every 4 seconds) and merge any messages newer than the latest one currently held; stop polling when the screen loses focus. No websockets/SSE in this slice — real-time push is a future slice.
- The match overlay's "Match ansehen" button keeps navigating to `Main` → `Chats` (the conversations list) as today; it does not deep-link directly into the new conversation in this slice (see open question 2).

## Acceptance criteria

1. When a mutual like completes a match in `POST /v1/swipes`, exactly one `conversations` row is created for that match's `matchId`; re-triggering the same match path (if ever possible) does not create a duplicate conversation.
2. `GET /v1/conversations` returns one entry per match the caller is part of, including matches with zero messages (`lastMessage: null`).
3. `GET /v1/conversations` orders conversations with a message more recently than other conversations first, and respects `limit`/`cursor` with no repeated `conversationId`s across pages.
4. `GET /v1/conversations/:conversationId/messages` returns `404` for a `conversationId` that doesn't exist or that the caller isn't a participant of.
5. `GET /v1/conversations/:conversationId/messages` returns messages newest-first, paginates via `cursor` with no repeated `messageId`s, and only ever returns messages belonging to that conversation.
6. `POST /v1/conversations/:conversationId/messages` with a valid 1–2000-char trimmed `body` creates a message with `senderUserId` equal to the caller and returns it with a `201`.
7. `POST /v1/conversations/:conversationId/messages` returns `400` for an empty/whitespace-only or over-length `body`, and `404` for a `conversationId` the caller isn't a participant of (including a conversation that exists but belongs to someone else's match).
8. After sending a message, that conversation's `lastMessage` in `GET /v1/conversations` reflects the new message immediately (no stale cache).
9. Mobile: the Chats tab shows a last-message preview (or empty-state copy) per match instead of "Chat folgt bald", and tapping a row opens the `Conversation` screen with that match's history loaded.
10. Mobile: sending a message in the `Conversation` screen appends it to the visible list without requiring a manual refresh, and a message sent from one account appears for the matched account within one polling interval.
11. Mobile: polling stops while the `Conversation` screen is not focused (e.g., verified by no further network calls after navigating away) and resumes on return.

## Out of scope

- Real-time delivery via websockets/SSE/push — polling only in this slice; flagged as a future slice.
- Read receipts / "seen" state.
- Typing indicators.
- Attachments, images, or any non-text message content.
- Push notifications for new messages.
- Editing or deleting a sent message.
- Group conversations (always exactly 1:1, tied to a `matches` row).
- Un-matching / conversation deletion flows (ties into slice 5's blocking/reporting work).
- Message search or full-text indexing.
- Deep-linking the match overlay directly into the new conversation (kept navigating to the list, as today).

## Open questions

1. **Conversation creation timing** — this doc creates the conversation eagerly alongside the match (in `POST /v1/swipes`) rather than lazily on first message, so every match always has exactly one conversation and the Chats list never needs a "match without conversation" fallback. Confirm this is preferred over lazy creation.
2. **Match overlay deep link** — should "Match ansehen" eventually jump straight into the new conversation (requires `POST /v1/swipes`'s `matched: true` response to also return `conversationId`), or is navigating to the Chats list (current behavior, kept here) good enough for this slice?
3. **Polling interval** — proposed 4 seconds while the `Conversation` screen is focused. Confirm this cadence is acceptable (battery/server load vs. perceived responsiveness), or specify a different value.
4. **Message length limit** — proposed 2000 chars, matching a generous chat-message ceiling. Confirm, or specify a shorter mobile-appropriate limit.
5. **`GET /v1/matches` fate** — this slice leaves `GET /v1/matches` in place unchanged (superseded for UI purposes by `GET /v1/conversations`). Confirm it's fine to keep both endpoints indefinitely, or should `GET /v1/matches` be deprecated/removed once the mobile client switches over?
