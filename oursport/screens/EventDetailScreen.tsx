import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useContext, useState } from "react";
import { ActivityIndicator, Linking, Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { AuthContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
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
import type { EventDetail } from "../lib/types";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function EventDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "EventDetail">) {
  const { palette: C, styles } = useTheme();
  const { eventId } = route.params;
  const auth = useContext(AuthContext);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiRequest<EventDetail>(`/v1/events/${eventId}`, auth);
      setEvent(response);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, eventId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleEventAction = async () => {
    if (!event || submitting) return;
    hapticImpact();
    const previous = event;
    const path = `/v1/events/${eventId}/${eventActionPath(previous)}`;
    setSubmitting(true);
    setActionError(null);
    setEvent({ ...optimisticEventUpdate(previous), attendees: previous.attendees });
    try {
      const { waitlistPosition: nextWaitlistPosition, ...updated } = await apiRequest<
        EventDetail & { waitlistPosition?: number }
      >(path, auth, { method: "POST" });
      setEvent((current) => (current ? { ...current, ...updated } : current));
      setWaitlistPosition(nextWaitlistPosition);
    } catch (caught) {
      setEvent(previous);
      setActionError(describeApiError(caught, "Aktion fehlgeschlagen, bitte erneut versuchen"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.conversationHeader}>
        <Button
          size="icon"
          variant="ghost"
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Zurueck"
          icon={<Ionicons name="chevron-back" size={24} color={C.ink} />}
        />
        <Text style={styles.headerTitle}>Event</Text>
        <View style={styles.backButton} />
      </View>
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={C.ink} />
        </View>
      ) : loadError || !event ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Event nicht gefunden"
          body="Das Event konnte nicht geladen werden."
          actionLabel="Erneut versuchen"
          onAction={() => void load()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.helper}>
            {formatEventDay(event.startsAt)}. {formatEventMonth(event.startsAt)} ·{" "}
            {formatEventTime(event.startsAt)} · {event.city}
          </Text>
          <Text style={styles.label}>Sportart</Text>
          <Text style={styles.cardMeta}>{event.sport}</Text>
          {event.description && (
            <>
              <Text style={styles.label}>Beschreibung</Text>
              <Text style={styles.cardMeta}>{event.description}</Text>
            </>
          )}
          <Pressable
            style={styles.mapLink}
            onPress={() =>
              Linking.openURL(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                  `${event.title}, ${event.city}`,
                )}`,
              )
            }
          >
            <Ionicons name="location" size={16} color={C.ink} />
            <Text style={styles.mapLinkText}>In Karte oeffnen</Text>
          </Pressable>
          <Text style={styles.label}>Veranstalter</Text>
          <Text style={styles.cardMeta}>{event.creatorName}</Text>
          <Text style={styles.label}>Plaetze</Text>
          <Text style={styles.cardMeta}>
            {event.attendeeCount}/{event.capacity} belegt · {event.spotsLeft} frei
          </Text>
          {actionError && (
            <Text style={styles.errorText}>{actionError}</Text>
          )}
          <Button
            variant={event.isAttending || event.isWaitlisted ? "ghost" : "primary"}
            label={eventJoinLabel(event, waitlistPosition)}
            onPress={() => void toggleEventAction()}
            disabled={submitting || event.isCreator}
            textColor={eventJoinTextColor(event, C)}
            textStyle={styles.joinText}
            style={[
              styles.join,
              styles.eventDetailJoin,
              (event.isAttending || event.isWaitlisted) && styles.joinActive,
            ]}
          />
          <Text style={[styles.label, { marginTop: spacing.xl }]}>Teilnehmer</Text>
          {event.attendees.map((attendee) => (
            <View style={styles.settings} key={attendee.userId}>
              <Text style={styles.settingsText}>{attendee.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
