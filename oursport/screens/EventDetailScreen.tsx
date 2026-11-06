import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useContext, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { AuthContext, ProfileContext } from "../context/AppContext";
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
import type { EventDetail, EventPhoto } from "../lib/types";
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
  const profile = useContext(ProfileContext);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | undefined>(undefined);

  const [photos, setPhotos] = useState<EventPhoto[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoCaption, setPhotoCaption] = useState("");
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<EventPhoto | null>(null);

  const [ratingDrafts, setRatingDrafts] = useState<Record<string, { stars: number; comment: string }>>({});
  const [submittingRatingUserId, setSubmittingRatingUserId] = useState<string | null>(null);
  const [ratingError, setRatingError] = useState<string | null>(null);

  const loadPhotos = useCallback(async () => {
    try {
      const response = await apiRequest<{ photos: EventPhoto[]; nextCursor: string | null }>(
        `/v1/events/${eventId}/photos`,
        auth,
      );
      setPhotos(response.photos);
    } catch {
      setPhotos([]);
    }
  }, [auth.token, auth.userId, eventId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiRequest<EventDetail>(`/v1/events/${eventId}`, auth);
      setEvent(response);
      const isPast = new Date(response.startsAt).getTime() <= Date.now();
      const attended = response.attendees.some((attendee) => attendee.userId === profile?.userId);
      if (isPast && attended) void loadPhotos();
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, eventId, profile?.userId, loadPhotos]);

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

  const pickPhoto = async () => {
    if (uploadingPhoto) return;
    setPhotoUploadError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoUploadError("Zugriff auf Fotos wurde nicht erlaubt.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.4,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const photoData = `data:image/jpeg;base64,${result.assets[0].base64}`;
    if (photoData.length > 350_000) {
      setPhotoUploadError("Foto ist zu gross, bitte ein kleineres Bild waehlen.");
      return;
    }
    setUploadingPhoto(true);
    try {
      const created = await apiRequest<EventPhoto>(`/v1/events/${eventId}/photos`, auth, {
        method: "POST",
        body: JSON.stringify({ photoData, caption: photoCaption.trim() || undefined }),
      });
      setPhotos((current) => [created, ...current]);
      setPhotoCaption("");
    } catch (caught) {
      setPhotoUploadError(describeApiError(caught, "Foto konnte nicht hochgeladen werden"));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const setRatingStars = (attendeeUserId: string, stars: number) => {
    setRatingDrafts((current) => ({
      ...current,
      [attendeeUserId]: { stars, comment: current[attendeeUserId]?.comment ?? "" },
    }));
  };

  const setRatingComment = (attendeeUserId: string, comment: string) => {
    setRatingDrafts((current) => ({
      ...current,
      [attendeeUserId]: { stars: current[attendeeUserId]?.stars ?? 0, comment },
    }));
  };

  const submitRating = async (attendeeUserId: string) => {
    const draft = ratingDrafts[attendeeUserId];
    if (!draft?.stars || submittingRatingUserId) return;
    setSubmittingRatingUserId(attendeeUserId);
    setRatingError(null);
    try {
      await apiRequest(`/v1/events/${eventId}/ratings/${attendeeUserId}`, auth, {
        method: "POST",
        body: JSON.stringify({ stars: draft.stars, comment: draft.comment.trim() || undefined }),
      });
      await load();
    } catch (caught) {
      setRatingError(describeApiError(caught, "Bewertung konnte nicht gespeichert werden"));
    } finally {
      setSubmittingRatingUserId(null);
    }
  };

  const isPastEvent = event ? new Date(event.startsAt).getTime() <= Date.now() : false;
  const callerAttended = event ? event.attendees.some((attendee) => attendee.userId === profile?.userId) : false;

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
          {event.isAttending && (
            <Button
              variant="secondary"
              label="Zum Event-Chat"
              onPress={() =>
                navigation.navigate("Conversation", {
                  conversationId: event.conversationId,
                  name: event.title,
                  isGroup: true,
                })
              }
              style={{ marginTop: spacing.md, alignSelf: "flex-start" }}
            />
          )}
          {isPastEvent && callerAttended && (
            <>
              <Text style={[styles.label, { marginTop: spacing.xl }]}>Fotos</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoGalleryRow}
              >
                <Pressable
                  style={styles.photoUploadThumb}
                  onPress={() => void pickPhoto()}
                  disabled={uploadingPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Foto hochladen"
                >
                  {uploadingPhoto ? (
                    <ActivityIndicator color={C.ink} />
                  ) : (
                    <Ionicons name="add" size={28} color={C.ink} />
                  )}
                </Pressable>
                {photos.map((photo) => (
                  <Pressable
                    key={photo.photoId}
                    style={styles.photoThumb}
                    onPress={() => setSelectedPhoto(photo)}
                  >
                    <Image source={{ uri: photo.photoData }} style={styles.photoThumbImage} />
                  </Pressable>
                ))}
              </ScrollView>
              <TextInput
                value={photoCaption}
                onChangeText={setPhotoCaption}
                placeholder="Bildunterschrift (optional)"
                placeholderTextColor={C.mist}
                style={styles.input}
                maxLength={200}
              />
              {photoUploadError && <Text style={styles.errorText}>{photoUploadError}</Text>}
            </>
          )}
          <Text style={[styles.label, { marginTop: spacing.xl }]}>Teilnehmer</Text>
          {event.attendees.map((attendee) => {
            const draft = ratingDrafts[attendee.userId];
            return (
              <View style={styles.attendeeRow} key={attendee.userId}>
                <View style={styles.attendeeTop}>
                  <Text style={styles.settingsText}>
                    {attendee.name}
                    {attendee.leftAt ? " (nicht mehr dabei)" : ""}
                  </Text>
                  {attendee.ratingCount > 0 && (
                    <View style={styles.attendeeRatingBadge}>
                      <Ionicons name="star" size={14} color={C.ember} />
                      <Text style={styles.attendeeRatingText}>
                        {attendee.averageRating?.toFixed(1)} ({attendee.ratingCount})
                      </Text>
                    </View>
                  )}
                </View>
                {attendee.canRate && (
                  <>
                    <View style={styles.starRow}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Pressable
                          key={value}
                          onPress={() => setRatingStars(attendee.userId, value)}
                          accessibilityRole="button"
                          accessibilityLabel={`${value} Sterne`}
                        >
                          <Ionicons
                            name={(draft?.stars ?? 0) >= value ? "star" : "star-outline"}
                            size={22}
                            color={C.ember}
                          />
                        </Pressable>
                      ))}
                    </View>
                    <TextInput
                      value={draft?.comment ?? ""}
                      onChangeText={(text) => setRatingComment(attendee.userId, text)}
                      placeholder="Kommentar (optional)"
                      placeholderTextColor={C.mist}
                      style={styles.input}
                      maxLength={300}
                    />
                    <Button
                      variant="secondary"
                      label="Bewerten"
                      onPress={() => void submitRating(attendee.userId)}
                      disabled={!draft?.stars || submittingRatingUserId === attendee.userId}
                      loading={submittingRatingUserId === attendee.userId}
                    />
                  </>
                )}
              </View>
            );
          })}
          {ratingError && <Text style={styles.errorText}>{ratingError}</Text>}
        </ScrollView>
      )}
      <Modal
        visible={Boolean(selectedPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <Pressable style={styles.photoModalOverlay} onPress={() => setSelectedPhoto(null)}>
          {selectedPhoto && (
            <Image source={{ uri: selectedPhoto.photoData }} style={styles.photoModalImage} resizeMode="contain" />
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
