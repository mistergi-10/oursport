# Slice 6: Design system & UI polish

## Summary

Raise the perceived quality of the shipped app by replacing the current ad-hoc, per-screen styling in `oursport/App.tsx` with a small set of shared design tokens and components (type scale, spacing scale, shared `Button`/`Card`/`EmptyState`/`Skeleton` primitives), adding lightweight motion (press feedback, screen/overlay transitions, a swipeable match card, a match-celebration moment), fixing concrete dark-mode/contrast and screen-reader gaps, and removing dead style tokens — with no backend, schema, or API changes.

## Current state (verified in code)

- `createStyles` ([oursport/App.tsx](../../oursport/App.tsx#L2494)) is a single ~550-rule `StyleSheet.create` object. Every screen inlines its own numeric font sizes (10, 11, 12, 13, 14, 15, 18, 19, 21, 22, 23, 25, 28, 30, 38, 40, 70 all appear as separate literals) and spacing values (6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 22, 24, 28... all appear as separate literals) with no named scale — there is no `typography.ts`/`spacing.ts` equivalent, just the 7-color `Palette` type ([oursport/App.tsx](../../oursport/App.tsx#L47)) plus the two concrete palettes ([oursport/App.tsx](../../oursport/App.tsx#L58)-[L75](../../oursport/App.tsx#L75)).
- Primary/secondary/destructive buttons are redefined per call site instead of a shared `Button` component: `primary`/`primaryText` ([oursport/App.tsx](../../oursport/App.tsx#L2592)), `secondary`, `dangerButton`/`dangerButtonText`, the round `pass`/`like` swipe buttons, and the pill-shaped `join`/`joinActive`/`joinDisabled` event button are five independently-styled "button" concepts with no shared disabled/pressed-state treatment. None use the `style` *function* form of `Pressable` (`({ pressed }) => [...]`), so none of them visually react to being pressed — a tap only shows the OS-default ripple/opacity (if any) rather than an intentional press state.
- Cards are similarly duplicated: the swipe `matchCard` ([oursport/App.tsx](../../oursport/App.tsx#L2673)), the `event` list card ([oursport/App.tsx](../../oursport/App.tsx#L2778)), and the unused `stat`/`stats` card ([oursport/App.tsx](../../oursport/App.tsx#L2881)) each hand-roll their own radius/border/elevation instead of sharing one `Card` style; only `matchCard` sets `elevation` (Android-only; no `shadowColor`/`shadowOpacity`/`shadowRadius` companion for iOS, so the swipe card currently has no visible shadow on iOS/web).
- Several style keys are defined but never referenced anywhere in the component tree (confirmed via workspace search): `verified` ([oursport/App.tsx](../../oursport/App.tsx#L2871)), `stats`/`stat`/`statValue`/`statLabel` ([oursport/App.tsx](../../oursport/App.tsx#L2881)), `fab`/`fabText` ([oursport/App.tsx](../../oursport/App.tsx#L2831)), `distance`, `actionText`, `likeText`, `tabIcon`, `cardMenuButtonText`, `sendButtonText`, `overlayHeart`, `arrow`, `backArrow`. These are leftover from an earlier layout and are dead weight in the design system today.
- Every list/detail screen (`Matching` [oursport/App.tsx](../../oursport/App.tsx#L1022), `MatchesList` [oursport/App.tsx](../../oursport/App.tsx#L1237), `ConversationScreen` [oursport/App.tsx](../../oursport/App.tsx#L1360), `Events` [oursport/App.tsx](../../oursport/App.tsx#L1640), `EventDetailScreen` [oursport/App.tsx](../../oursport/App.tsx#L2000)) hand-rolls its own loading state (a single centered `ActivityIndicator`) and empty/error state (a `View style={styles.empty}` with a title + helper `Text`, sometimes a retry `Pressable`) instead of sharing one `LoadingState`/`EmptyState` component — copy, icon usage, and retry-button presence are inconsistent between screens (e.g. `Matching`'s "Verbindungsfehler" state has a retry button, `MatchesList`'s empty state never offers retry).
- There is no skeleton/shimmer loading anywhere — every loading state is a bare spinner, including the swipe-card screen where a placeholder card shape would better preserve layout.
- No animation library or API is used anywhere in the file: no `Animated`, no `LayoutAnimation`, no `react-native-reanimated`/`moti`, no `react-native-gesture-handler` (confirmed absent from [oursport/package.json](../../oursport/package.json)). Concretely this means: the match-celebration overlay in `MainTabs` ([oursport/App.tsx](../../oursport/App.tsx#L939)) appears/disappears with a hard `View` mount/unmount and no fade/scale-in; the swipe card in `Matching` only supports tapping the `pass`/`like` buttons ([oursport/App.tsx](../../oursport/App.tsx#L1022)) — there is no drag gesture on the card itself, no rotation/fly-off physics, despite the screen being the app's core "swiping" interaction; native-stack screen transitions use their un-customized platform defaults.
- Accessibility: there are zero occurrences of `accessibilityLabel` or `accessibilityRole` in the file (confirmed via workspace search). Icon-only controls have no screen-reader label, including the header filter button (`Header`, [oursport/App.tsx](../../oursport/App.tsx#L1003)), the card "…" overflow menu (`cardMenuButton`), the conversation back/send/menu buttons, and the profile photo picker. Text uses RN's default (uncapped) font scaling, so large accessibility text sizes are not actively broken, but layouts have not been checked against them.
- Contrast: `mist` (`#778078` light / `#8FA398` dark) is used for secondary text (`helper`, `cardMeta`, `chatPreview`, timestamps) on `cloud`/`court` backgrounds in both palettes and has not been checked against WCAG AA (4.5:1 for normal text, 3:1 for large text); `messageBubbleOwn` renders `messageText` in `C.ink` (near-black in light mode, near-white in dark mode) over a `C.ember` background (`#FF5C39` light / `#FF7A57` dark) — an orange bubble with near-black-on-orange in light mode is plausibly fine, but near-white-on-orange in dark mode has not been checked and is a likely AA failure.
- `docs/PROJECT_CONTEXT.md` still lists the original 5 slices under "Next product slices" and does not mention the theme system, `@expo/vector-icons`, or profile photos at all — it is stale relative to the shipped app and is updated as part of this slice (see below).

## User stories

1. As a user, every screen in the app (Welcome/Auth, Matching, Chats, Events, Profile, Privacy, Report) feels like it belongs to one consistent visual system — same type scale, same spacing rhythm, same button/card/chip shapes — instead of each screen having its own slightly different sizes.
2. As a user, when I tap a button or card, I get an immediate, pleasant visual confirmation (a subtle press-down/scale effect) instead of the control just feeling static.
3. As a user, swiping on the Matching screen feels tactile: I can drag the card left/right with my finger and see it rotate/fly off, not just tap two small buttons below a static photo.
4. As a user, getting a match feels like a small celebration (the match overlay animates in) rather than abruptly appearing on screen.
5. As a user, while content is loading I see a shape-preserving skeleton instead of a bare spinner jumping the layout around once data arrives.
6. As a user with a screen reader, every icon-only button (menu, back, send, filter, photo picker) announces what it does.
7. As a user in dark mode, all text remains comfortably readable against its background.
8. As a user, empty and error states across screens look and read consistently, and always tell me what to do next (retry, or what action produces content).

## Data model changes

None. This slice touches only `oursport/App.tsx`'s presentation layer (and optionally splits it into a few sibling files — see Out of scope). `server/src/db/schema.ts` is unchanged.

## API contract

None. No new/changed endpoints, request/response shapes, or auth rules. `server/src/index.ts` is unchanged.

## Mobile UI/UX notes

### Shared tokens & primitives (new, additive to `createStyles`)

- A `typography` scale (e.g. `display`, `title`, `subtitle`, `body`, `label`, `caption`), each with a fixed `fontSize`/`lineHeight`/`fontWeight`, replacing the current per-style literal sizes. Existing styles (`wordmark`, `title`, `headerTitle`, `cardName`, `helper`, `label`, etc.) are rewritten to reference the scale rather than re-declaring their own numbers.
- A `spacing` scale (e.g. `spacing.xs=4, sm=8, md=12, lg=16, xl=24, xxl=32`) used for padding/margin/gap everywhere instead of ad-hoc literals.
- A `radius` scale (e.g. `sm=10, md=16, lg=22, pill=999`) and an `elevation`/shadow helper that sets both Android `elevation` and the iOS `shadow*` properties together, so card/overlay shadows render on every platform (including web, where `boxShadow`-equivalent styling is needed).
- A shared `Button` component (`variant`: `primary` | `secondary` | `danger`; `size`: default | `icon`) replacing the five independently-styled button treatments, using the style-function form of `Pressable` to apply a pressed-state (scale/opacity) style.
- A shared `Card` style/component used by the swipe card, event card, and any future card-shaped content.
- Shared `EmptyState` and `LoadingState`/`Skeleton` components: `EmptyState({ icon, title, body, actionLabel?, onAction? })` for the "no data"/"error" cases (used by `Matching`, `MatchesList`, `Events`, `EventDetailScreen`, `ConversationScreen`), and a `Skeleton` block (simple pulsing/opacity-animated `View`s) shaped like the content it's replacing (a card outline for `Matching`/`Events`, a row outline for `MatchesList`), used while the corresponding `loading` state is true instead of a bare `ActivityIndicator`.
- Dead style keys (`verified`, `stats`, `stat`, `statValue`, `statLabel`, `fab`, `fabText`, `distance`, `actionText`, `likeText`, `tabIcon`, `cardMenuButtonText`, `sendButtonText`, `overlayHeart`, `arrow`, `backArrow`) are deleted as part of this cleanup unless a specific per-screen note below reuses one of them for new purpose.

### Per-screen notes

- **Welcome/Auth** (`WelcomeScreen`, `SignupScreen`, `LoginScreen`, `ForgotPasswordScreen`, `ResetPasswordScreen`): adopt the shared `Button`/typography/spacing tokens; add a subtle entrance animation for the hero/`BrandMark` on first mount (fade + slight rise, one-shot, respecting reduced-motion — see acceptance criteria).
- **Matching**: the swipe card becomes a draggable/swipeable component — drag left/right triggers `pass`/`like` respectively past a distance threshold, with the card rotating slightly as it's dragged and animating off-screen on release past the threshold (snapping back if released before the threshold); the existing `pass`/`like` buttons remain as an accessible, non-gesture-dependent alternative that trigger the same fly-off animation programmatically. Loading state becomes a card-shaped `Skeleton`. The "…" overflow button (`cardMenuButton`) gets `accessibilityLabel="Weitere Optionen"` and `accessibilityRole="button"`.
- **Match overlay** (`MainTabs`): the overlay (`styles.overlay`/`overlayCard`) animates in (fade + scale-up from ~0.9 to 1) when `activeMatch` is set, instead of appearing instantly; the `Ionicons name="heart"` gets a small celebratory flourish (e.g. a brief scale/bounce) on entrance.
- **Chats (`MatchesList`)**: empty/loading states move to the shared `EmptyState`/row-shaped `Skeleton`; the unread checkmark indicator and relative-time text get a contrast check in dark mode.
- **Conversation**: message bubbles adopt the shared radius/spacing tokens; a new message appearing (from send or poll) gets a brief fade/slide-in instead of popping in instantly; `backButton`, the "…" menu, and the send button each get `accessibilityLabel`s ("Zurueck", "Weitere Optionen", "Senden").
- **Events / Event detail**: event cards adopt the shared `Card` style and shadow helper (currently Android-only `elevation` is missing on the `event` card entirely); loading/empty/error states move to shared components; the join/leave button keeps its existing active/disabled color logic but adopts the shared `Button` press-state.
- **Profile**: the dark-mode `Switch` and settings rows adopt spacing tokens; the photo-picker `Pressable` gets `accessibilityLabel="Profilfoto aendern"`.
- **Privacy / Report**: the destructive delete-account button and reason `Chip`s adopt the shared `Button`/`Chip` press states; no behavior change.
- **Tab bar**: icon swap between focused/unfocused state gets a brief, cheap crossfade/scale rather than an instant swap (if feasible without a new animation dependency — see open question 1).

## Acceptance criteria

1. `oursport/App.tsx` (or its post-split equivalent) exposes a single named `typography` scale and a single named `spacing` scale; no screen-level style in `createStyles` declares a bespoke `fontSize` or spacing number that duplicates an existing scale step (new one-off values require a documented exception, not silent duplication).
2. The `verified`, `stats`, `stat`, `statValue`, `statLabel`, `fab`, `fabText`, `distance`, `actionText`, `likeText`, `tabIcon`, `cardMenuButtonText`, `sendButtonText`, `overlayHeart`, `arrow`, and `backArrow` style keys no longer exist in `createStyles` (or are demonstrably in use if repurposed).
3. Every `Pressable` that functions as a primary/secondary/danger button or icon-button visibly changes appearance (opacity and/or scale) between its pressed and unpressed state.
4. The event list card and the swipe `matchCard` both render a visible shadow/elevation on iOS, Android, and web.
5. Dragging the Matching screen's current card left or right past a fixed horizontal threshold triggers the same `pass`/`like` request as tapping the corresponding button, and the card animates off-screen in the drag direction; releasing before the threshold animates the card back to center. The existing tap-to-swipe buttons keep working unchanged.
6. The match-celebration overlay's entrance is animated (not an instant appear) on at least iOS and Android.
7. `Matching`, `MatchesList`, and `Events` show a shape-preserving skeleton (not a bare spinner) while their initial `loading` state is true.
8. Every icon-only interactive element identified in the per-screen notes (header filter button, card overflow menu, conversation back/menu/send buttons, profile photo picker) has a non-empty `accessibilityLabel` and `accessibilityRole="button"`.
9. `EmptyState` is used by `Matching`, `MatchesList`, `Events`, `EventDetailScreen`, and `ConversationScreen` for their "no data"/"error" renders, each showing a title, a body line, and — for every state that previously had a retry action (e.g. `Matching`'s and `Events`' load-error states) — a retry button.
10. Every text/background color pair newly identified as a risk in "Current state" (`mist` secondary text on `cloud`/`court`; `messageBubbleOwn` text on `ember`) is measured against WCAG AA and either passes or is adjusted (e.g. a darker/lighter shade of the same token) until it passes, in both light and dark palettes.
11. `npm run web` (or `tsc --noEmit`) in `oursport/` still passes with no new TypeScript errors after the refactor.
12. No request/response shape, endpoint, or `server/src/db/schema.ts` table/column changes anywhere in this slice's diff.
13. `docs/PROJECT_CONTEXT.md`'s "Next product slices" section reflects that slices 1–5 have shipped and that this design-system/UI-polish slice is the active/next one.

## Out of scope

- Any new backend endpoint, request/response field, or database table/column — this is a pure frontend/visual slice.
- Splitting `App.tsx` into multiple files/folders is allowed as a byproduct of adding shared `Button`/`Card`/`EmptyState`/`Skeleton` components, but is not itself a requirement — a single-file implementation that meets the acceptance criteria is acceptable.
- A full custom illustration set or brand mascot — this slice only covers icon usage (`@expo/vector-icons`, already in place) and the existing `BrandMark`/wordmark treatment, not commissioning new artwork.
- Push notifications, haptics (`expo-haptics`), or sound as part of the match-celebration moment.
- Localization/i18n of the (currently German-only) copy.
- Changing the Expo/React Native/React Navigation major versions, or any dependency not strictly needed for this slice's animation/gesture work.
- Per-field inline validation styling overhaul of every form (e.g. red-border-on-invalid for every `TextInput`) beyond what's already covered by existing `errorText` messaging — only the specific contrast fixes in the acceptance criteria are required.
- Automated accessibility or visual-regression test tooling/CI integration — acceptance criterion 8/10 are verified manually or via ad-hoc script, not a new test suite.
- Reduced-motion *system-setting* detection (`AccessibilityInfo.isReduceMotionEnabled`) is encouraged but not required to ship this slice — flagged as an open question below.

## Open questions

1. **Animation/gesture dependencies**: delivering a real drag-to-swipe card (acceptance criterion 5) and smooth entrance/press animations cleanly needs either `react-native-reanimated` + `react-native-gesture-handler` (and optionally `moti` on top), or a hand-rolled solution using only the already-available `Animated`/`PanResponder` APIs built into `react-native` core. The former gives much better results (and is close to the de-facto standard for this exact "Tinder-style swipe card" pattern) but is a new dependency addition in an Expo 57 project that has deliberately stayed dependency-light so far. **Decision needed**: is adding `react-native-reanimated` + `react-native-gesture-handler` (and optionally `moti`) acceptable, or should this slice use only built-in `Animated`/`PanResponder`?
2. **Reduced motion**: should all new animations respect `AccessibilityInfo.isReduceMotionEnabled()` / `prefers-reduced-motion` on web (skipping/shortening them for users who've opted out of motion at the OS level), or is that explicitly deferred to a later slice?
3. **Brand/illustration direction**: is there an existing brand style guide (colors beyond the current `Palette`, a preferred illustration style for empty states, a specific icon set beyond Ionicons) to align to, or is the agent free to design empty-state iconography using the existing Ionicons set and palette?
4. **Scope of the `App.tsx` split**: is breaking the single large file into multiple files (e.g. `theme.ts`, `components/`, `screens/`) desired as part of this slice, or should the file stay monolithic for now (tokens/components added in-place) to keep the diff reviewable?
5. **Contrast fix tolerance**: where a current color (e.g. `mist`) fails WCAG AA, is a palette-level fix (adjusting `mist`'s hex value, affecting every screen that uses it) acceptable, or must the existing seven-color `Palette` values stay pixel-identical and any contrast fix be scoped to specific usages only?

## Decisions (product owner, 2026-11-01)

Go with the maximal/highest-quality option on every open question above:

1. **Animation/gesture dependencies**: approved. Add `react-native-reanimated`, `react-native-gesture-handler`, and `moti` (via `npx expo install` for the first two to get SDK-57-compatible versions; `moti` as a plain npm dep on top of reanimated).
2. **Reduced motion**: in scope for this slice. New animations check `AccessibilityInfo.isReduceMotionEnabled()` (and respect `prefers-reduced-motion` on web) and skip/shorten accordingly.
3. **Brand/illustration direction**: no existing style guide — full creative latitude using the existing Ionicons set and `Palette` tokens for empty-state iconography and any new celebratory flourishes.
4. **Scope of the `App.tsx` split**: in scope. Split the monolith into `theme.ts`, `components/` (shared `Button`/`Card`/`EmptyState`/`Skeleton`/etc.), and per-screen files under `screens/`, with `App.tsx` reduced to composition/navigation wiring.
5. **Contrast fix tolerance**: approved. Palette hex values may be adjusted directly where needed to pass WCAG AA, in both light and dark palettes.
