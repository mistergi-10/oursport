import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useContext, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { CardSkeleton } from "../components/Skeleton";
import { AuthContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import { sports } from "../lib/constants";
import { hapticImpact } from "../lib/haptics";
import {
  eventActionPath,
  eventJoinLabel,
  eventJoinTextColor,
  formatEventDay,
  formatEventMonth,
  formatEventTime,
  optimisticEventUpdate,
} from "../lib/format";
import type { EventSummary } from "../lib/types";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function Events() {
  const { palette: C, styles } = useTheme();
  const auth = useContext(AuthContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [eventsList, setEventsList] = useState<EventSummary[]>([]);
  const [forYouEvents, setForYouEvents] = useState<EventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced copy of searchQuery that actually drives the fetch, so typing
  // doesn't fire a network request on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [mineFilter, setMineFilter] = useState<"all" | "mine" | "past">("all");
  const [actionErrorEventId, setActionErrorEventId] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState("Aktion fehlgeschlagen, bitte erneut versuchen");
  const [pendingEventIds, setPendingEventIds] = useState<Set<string>>(new Set());
  const [waitlistPositions, setWaitlistPositions] = useState<Record<string, number>>({});

  useEffect(() => {
    const timeoutId = setTimeout(() => setDebouncedQuery(searchQuery), 350);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const buildEventsPath = useCallback(
    (cursor: string | null) => {
      const params: string[] = [];
      if (debouncedQuery.trim()) params.push(`q=${encodeURIComponent(debouncedQuery.trim())}`);
      if (sportFilter) params.push(`sport=${encodeURIComponent(sportFilter)}`);
      if (mineFilter !== "all") params.push("mine=true");
      if (mineFilter === "past") params.push("when=past");
      if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
      return params.length > 0 ? `/v1/events?${params.join("&")}` : "/v1/events";
    },
    [debouncedQuery, sportFilter, mineFilter],
  );

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiRequest<{ events: EventSummary[]; nextCursor: string | null }>(
        buildEventsPath(null),
        auth,
      );
      setEventsList(response.events);
      setNextCursor(response.nextCursor);
    } catch {
      setEventsList([]);
      setNextCursor(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, buildEventsPath]);

  const loadForYou = useCallback(async () => {
    try {
      const response = await apiRequest<{ events: EventSummary[]; nextCursor: string | null }>(
        "/v1/events/for-you",
        auth,
      );
      setForYouEvents(response.events);
    } catch {
      setForYouEvents([]);
    }
  }, [auth.token, auth.userId]);

  // Re-runs whenever the filters change (not just on tab focus), since
  // useFocusEffect re-invokes its callback immediately when already focused.
  useFocusEffect(
    useCallback(() => {
      void loadEvents();
    }, [loadEvents]),
  );

  useFocusEffect(
    useCallback(() => {
      void loadForYou();
    }, [loadForYou]),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await apiRequest<{ events: EventSummary[]; nextCursor: string | null }>(
        buildEventsPath(nextCursor),
        auth,
      );
      setEventsList((current) => [...current, ...response.events]);
      setNextCursor(response.nextCursor);
    } catch {
      // leave nextCursor as-is so the user can tap "Mehr laden" again
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleEventAction = async (event: EventSummary) => {
    if (pendingEventIds.has(event.eventId)) return;
    hapticImpact();
    setActionErrorEventId(null);
    setPendingEventIds((current) => new Set(current).add(event.eventId));
    const path = `/v1/events/${event.eventId}/${eventActionPath(event)}`;
    setEventsList((current) =>
      current.map((item) => (item.eventId === event.eventId ? optimisticEventUpdate(event) : item)),
    );
    try {
      const updated = await apiRequest<EventSummary & { waitlistPosition?: number }>(path, auth, {
        method: "POST",
      });
      setEventsList((current) =>
        current.map((item) => (item.eventId === event.eventId ? updated : item)),
      );
      setWaitlistPositions((current) => {
        const next = { ...current };
        if (typeof updated.waitlistPosition === "number") next[event.eventId] = updated.waitlistPosition;
        else delete next[event.eventId];
        return next;
      });
    } catch (caught) {
      setEventsList((current) =>
        current.map((item) => (item.eventId === event.eventId ? event : item)),
      );
      setActionErrorMessage(describeApiError(caught, "Aktion fehlgeschlagen, bitte erneut versuchen"));
      setActionErrorEventId(event.eventId);
    } finally {
      setPendingEventIds((current) => {
        const next = new Set(current);
        next.delete(event.eventId);
        return next;
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Events" actionIcon="add" actionAccessibilityLabel="Event erstellen" onAction={() => navigation.navigate("CreateEvent")} accentColor="ember" />
      <TextInput
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder="Suche nach Ort oder Stichwort"
        placeholderTextColor={C.mist}
        style={[styles.input, { marginBottom: spacing.md }]}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Chip label="Alle" selected={mineFilter === "all"} onPress={() => setMineFilter("all")} />
        <Chip label="Meine kommenden" selected={mineFilter === "mine"} onPress={() => setMineFilter("mine")} />
        <Chip label="Meine vergangenen" selected={mineFilter === "past"} onPress={() => setMineFilter("past")} />
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Chip label="Alle" selected={sportFilter === null} onPress={() => setSportFilter(null)} />
        {sports.map((item) => (
          <Chip
            key={item}
            label={item}
            selected={sportFilter === item}
            onPress={() => setSportFilter(item)}
          />
        ))}
      </ScrollView>
      {mineFilter === "all" && forYouEvents.length > 0 && (
        <>
          <Text style={styles.label}>Fuer dich</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.forYouRow}
          >
            {forYouEvents.map((item) => (
              <Pressable
                key={item.eventId}
                onPress={() => navigation.navigate("EventDetail", { eventId: item.eventId })}
              >
                <Card style={styles.forYouCard}>
                  <Text style={styles.dateNumber}>{formatEventDay(item.startsAt)}</Text>
                  <Text style={styles.dateMonth}>{formatEventMonth(item.startsAt)}</Text>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {item.city}
                  </Text>
                </Card>
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      {loading ? (
        <CardSkeleton />
      ) : loadError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Verbindungsfehler"
          body="Events konnten nicht geladen werden."
          actionLabel="Erneut versuchen"
          onAction={() => void loadEvents()}
        />
      ) : eventsList.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Keine Events gefunden"
          body="Erstelle das erste Event ueber den Plus-Button oben."
        />
      ) : (
        <>
          {eventsList.map((item) => (
            <Pressable
              key={item.eventId}
              onPress={() => navigation.navigate("EventDetail", { eventId: item.eventId })}
            >
              <Card
                style={{
                  borderWidth: 1,
                  borderColor: C.line,
                  padding: spacing.lg,
                  marginBottom: spacing.md,
                }}
              >
                <View style={styles.eventTop}>
                  <View style={styles.date}>
                    <Text style={styles.dateNumber}>{formatEventDay(item.startsAt)}</Text>
                    <Text style={styles.dateMonth}>{formatEventMonth(item.startsAt)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.eventTitle}>{item.title}</Text>
                    <Text style={styles.eventMeta}>
                      {formatEventTime(item.startsAt)} · {item.city}
                    </Text>
                  </View>
                </View>
                <View style={styles.eventFooter}>
                  <Text style={styles.helper}>
                    {item.attendeeCount}/{item.capacity} · {item.spotsLeft} frei
                  </Text>
                  <Button
                    variant={item.isAttending || item.isWaitlisted ? "ghost" : "primary"}
                    label={eventJoinLabel(item, waitlistPositions[item.eventId])}
                    onPress={() => void toggleEventAction(item)}
                    disabled={item.isCreator || pendingEventIds.has(item.eventId)}
                    textColor={eventJoinTextColor(item, C)}
                    textStyle={styles.joinText}
                    style={[
                      styles.join,
                      (item.isAttending || item.isWaitlisted) && styles.joinActive,
                    ]}
                  />
                </View>
                {actionErrorEventId === item.eventId && (
                  <Text style={styles.errorText}>{actionErrorMessage}</Text>
                )}
              </Card>
            </Pressable>
          ))}
          {nextCursor && (
            <Button variant="secondary" label="Mehr laden" loading={loadingMore} onPress={loadMore} disabled={loadingMore} />
          )}
        </>
      )}
    </ScrollView>
  );
}
