import i18n from "./i18n";
import type { EventSummary } from "./types";
import type { Palette } from "../theme/tokens";
import { INK_FIXED } from "../theme/tokens";

// Per-locale Intl tag for date/time formatting (see Decisions: fixed regional
// variants with 24-hour time forced on all three, not locale-default AM/PM).
const intlLocaleTags: Record<string, string> = { de: "de-CH", en: "en-US", fr: "fr-FR" };
function intlLocale(locale: string) {
  return intlLocaleTags[locale] ?? intlLocaleTags.de;
}

export function formatRelativeTime(iso: string, locale: string = i18n.language) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return i18n.t("format.now", { lng: locale });
  if (minutes < 60) return i18n.t("format.minutesAgo", { count: minutes, lng: locale });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return i18n.t("format.hoursAgo", { count: hours, lng: locale });
  const days = Math.floor(hours / 24);
  return i18n.t("format.daysAgo", { count: days, lng: locale });
}

export function formatMessageTime(iso: string, locale: string = i18n.language) {
  return new Date(iso).toLocaleTimeString(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatEventDay(iso: string) {
  return String(new Date(iso).getDate()).padStart(2, "0");
}
export function formatEventMonth(iso: string, locale: string = i18n.language) {
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short" }).format(new Date(iso));
}
export function formatEventTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
export function eventJoinLabel(event: EventSummary, waitlistPosition?: number) {
  if (event.isCreator) return i18n.t("format.eventJoin.host");
  if (event.isAttending) return i18n.t("format.eventJoin.attending");
  if (event.isWaitlisted) {
    return i18n.t("format.eventJoin.waitlistLeave", { position: waitlistPosition ?? event.waitlistCount });
  }
  if (event.spotsLeft === 0) return i18n.t("format.eventJoin.waitlistJoin");
  return i18n.t("format.eventJoin.join");
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
