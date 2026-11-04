import type { EventSummary } from "./types";
import type { Palette } from "../theme/tokens";
import { INK_FIXED } from "../theme/tokens";

export function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Jetzt";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tg.`;
}

export function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}

const eventMonthNames = ["Jan", "Feb", "Maer", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
export function formatEventDay(iso: string) {
  return String(new Date(iso).getDate()).padStart(2, "0");
}
export function formatEventMonth(iso: string) {
  return eventMonthNames[new Date(iso).getMonth()];
}
export function formatEventTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export function eventJoinLabel(event: EventSummary, waitlistPosition?: number) {
  if (event.isCreator) return "Gastgeber";
  if (event.isAttending) return "Dabei ✓";
  if (event.isWaitlisted) return `Warteliste verlassen · Platz ${waitlistPosition ?? event.waitlistCount}`;
  if (event.spotsLeft === 0) return "Warteliste beitreten";
  return "Beitreten";
}

// Shared with Events and EventDetailScreen's join button, which otherwise
// each special-cased the same attending/waitlisted/default text color inline.
export function eventJoinTextColor(event: EventSummary, palette: Palette) {
  if (event.isAttending || event.isWaitlisted) return INK_FIXED;
  return undefined;
}

// Maps an event's current state to the next waitlist/membership action's path
// segment, matching the server's join/leave/waitlist/waitlist-leave routes.
export function eventActionPath(event: EventSummary) {
  if (event.isAttending) return "leave";
  if (event.isWaitlisted) return "waitlist/leave";
  if (event.spotsLeft === 0) return "waitlist";
  return "join";
}

// Optimistic local patch applied before the request above resolves; replaced
// with the server's response once it arrives (or reverted on error).
export function optimisticEventUpdate(event: EventSummary): EventSummary {
  if (event.isAttending) {
    return { ...event, isAttending: false, attendeeCount: event.attendeeCount - 1, spotsLeft: event.spotsLeft + 1 };
  }
  if (event.isWaitlisted) {
    return { ...event, isWaitlisted: false, waitlistCount: Math.max(0, event.waitlistCount - 1) };
  }
  if (event.spotsLeft === 0) {
    return { ...event, isWaitlisted: true, waitlistCount: event.waitlistCount + 1 };
  }
  return { ...event, isAttending: true, attendeeCount: event.attendeeCount + 1, spotsLeft: event.spotsLeft - 1 };
}


// Caps the per-poll catch-up loop so a server cursor that never resolves to
// null (or a message rate outpacing the client) can't page indefinitely.
export const MAX_POLL_PAGES = 25;
