import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Image, ScrollView, Text, View } from "react-native";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { CardSkeleton } from "../components/Skeleton";
import { SwipeCard, type SwipeCardHandle, type SwipeDirection } from "../components/SwipeCard";
import { AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import { sports } from "../lib/constants";
import { hapticImpact } from "../lib/haptics";
import type { Candidate, MatchInfo } from "../lib/types";
import { useTheme } from "../theme";
import { COURT_FIXED, radius } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function Matching({ onMatch }: { onMatch: (match: MatchInfo) => void }) {
  const { palette: C, styles } = useTheme();
  const auth = useContext(AuthContext);
  const profile = useContext(ProfileContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [queue, setQueue] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  // Set from the first page of each fresh discover load, not the running
  // queue length, so it reads as a stable "new profiles" stat rather than
  // shrinking as the user swipes through the already-fetched queue.
  const [freshCount, setFreshCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [swipeError, setSwipeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set the instant a swipe is committed (threshold crossed or tap), not only
  // once the async request starts, so a second drag/tap during the ~260ms
  // fly-off animation can't double-submit before `submitting` becomes true.
  const [isAnimatingAway, setIsAnimatingAway] = useState(false);
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const cardRef = useRef<SwipeCardHandle>(null);

  const loadCandidates = useCallback(
    async (afterCursor: string | null) => {
      setLoading(true);
      setLoadError(false);
      try {
        const params: string[] = [];
        if (sportFilter) params.push(`sport=${encodeURIComponent(sportFilter)}`);
        if (afterCursor) params.push(`cursor=${encodeURIComponent(afterCursor)}`);
        const query = params.length > 0 ? `?${params.join("&")}` : "";
        const response = await apiRequest<{ candidates: Candidate[]; nextCursor: string | null }>(
          `/v1/discover${query}`,
          auth,
        );
        setQueue((current) => [...current, ...response.candidates]);
        if (afterCursor === null) setFreshCount(response.candidates.length);
        setCursor(response.nextCursor);
        if (response.nextCursor === null) setExhausted(true);
      } catch {
        // distinct from "exhausted" so the UI can offer a retry instead of
        // implying there simply are no more candidates
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [auth.token, auth.userId, sportFilter],
  );

  useFocusEffect(
    useCallback(() => {
      setQueue([]);
      setCursor(null);
      setExhausted(false);
      setLoadError(false);
      setSwipeError(null);
      void loadCandidates(null);
    }, [loadCandidates]),
  );

  const current = queue[0];

  useEffect(() => {
    if (!current && !loading && !exhausted && !loadError && cursor) void loadCandidates(cursor);
  }, [current, loading, exhausted, loadError, cursor, loadCandidates]);

  const swipe = async (action: "like" | "pass") => {
    if (!current || submitting) return;
    const candidate = current;
    setSubmitting(true);
    setQueue((rest) => rest.slice(1));
    setSwipeError(null);
    try {
      const response = await apiRequest<
        | { matched: false }
        | { matched: true; match: Omit<MatchInfo, "conversationId">; conversationId: string | null }
      >("/v1/swipes", auth, {
        method: "POST",
        body: JSON.stringify({ targetUserId: candidate.userId, action }),
      });
      // The server returns `conversationId` as a sibling of `match`, not nested
      // inside it, so it has to be merged in here for the match overlay to be
      // able to deep-link straight into the conversation.
      if (response.matched) onMatch({ ...response.match, conversationId: response.conversationId });
    } catch (caught) {
      // requeue the candidate so the user can retry instead of silently losing the swipe
      setQueue((rest) => [candidate, ...rest]);
      setSwipeError(describeApiError(caught, "Verbindungsfehler, bitte erneut versuchen"));
    } finally {
      setSubmitting(false);
      setIsAnimatingAway(false);
    }
  };

  const onSwiped = useCallback((direction: SwipeDirection) => {
    void swipe(direction === "right" ? "like" : "pass");
  }, [swipe]);

  const handleCommit = useCallback(() => {
    hapticImpact();
    setIsAnimatingAway(true);
  }, []);

  const handleTap = (action: "like" | "pass") => {
    if (!current || submitting || isAnimatingAway) return;
    cardRef.current?.flyOff(action === "like" ? "right" : "left");
  };

  const blockCandidate = async (candidate: Candidate) => {
    setSwipeError(null);
    setQueue((rest) => rest.filter((item) => item.userId !== candidate.userId));
    try {
      await apiRequest("/v1/blocks", auth, {
        method: "POST",
        body: JSON.stringify({ userId: candidate.userId }),
      });
    } catch (caught) {
      setQueue((rest) => [candidate, ...rest]);
      setSwipeError(describeApiError(caught, "Blockieren fehlgeschlagen, bitte erneut versuchen"));
    }
  };

  const confirmBlockCandidate = (candidate: Candidate) => {
    Alert.alert(`${candidate.name} blockieren?`, "Ihr seht euch danach nicht mehr beim Matching.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => void blockCandidate(candidate) },
    ]);
  };

  const openCardMenu = (candidate: Candidate) => {
    Alert.alert(candidate.name, undefined, [
      {
        text: "Melden",
        onPress: () => navigation.navigate("Report", { userId: candidate.userId, name: candidate.name }),
      },
      { text: "Blockieren", style: "destructive", onPress: () => confirmBlockCandidate(candidate) },
      { text: "Abbrechen", style: "cancel" },
    ]);
  };

  const noMoreCandidates = !current && exhausted;
  const failedToLoad = !current && loadError && !exhausted;
  const initialLoading = !current && loading && !exhausted && !loadError;

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <Header title="Matching" accentColor="volt" />
      {profile && (
        <View style={styles.greetingRow}>
          <Text style={styles.greetingTitle}>Hallo, {profile.name} 👋</Text>
          <Text style={styles.greetingStat}>{freshCount} neue Profile in deiner Naehe</Text>
        </View>
      )}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {sports.map((item) => (
          <Chip
            key={item}
            label={item}
            selected={sportFilter === item}
            onPress={() => setSportFilter((current) => (current === item ? null : item))}
          />
        ))}
      </ScrollView>
      {noMoreCandidates ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="Das war's fuers Erste"
          body="Schau spaeter wieder vorbei, dann warten neue Trainingspartner auf dich."
        />
      ) : failedToLoad ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Verbindungsfehler"
          body="Kandidaten konnten nicht geladen werden."
          actionLabel="Erneut versuchen"
          onAction={() => void loadCandidates(cursor)}
        />
      ) : current ? (
        <>
          <SwipeCard
            key={current.userId}
            ref={cardRef}
            onSwiped={onSwiped}
            onCommit={handleCommit}
            disabled={submitting || isAnimatingAway}
          >
            <Card style={{ borderRadius: radius.xl, overflow: "hidden" }}>
              <View style={styles.photo}>
                {current.photoUrl ? (
                  <Image source={{ uri: current.photoUrl }} style={styles.photoImage} />
                ) : (
                  <Text style={styles.photoEmoji}>🏃</Text>
                )}
                <Button
                  size="icon"
                  variant="secondary"
                  style={styles.cardMenuButton}
                  onPress={() => openCardMenu(current)}
                  accessibilityLabel="Weitere Optionen"
                  icon={<Ionicons name="ellipsis-horizontal" size={18} color={C.ink} />}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardName}>{current.name}</Text>
                <Text style={styles.cardMeta}>
                  {current.sport} · {current.level}
                </Text>
                {current.bio && (
                  <View style={styles.tags}>
                    <Text style={styles.tag}>{current.bio}</Text>
                  </View>
                )}
              </View>
            </Card>
          </SwipeCard>
          {swipeError && (
            <Text style={styles.errorText}>{swipeError}</Text>
          )}
          <View style={styles.actions}>
            <Button
              size="icon"
              variant="secondary"
              style={styles.pass}
              onPress={() => handleTap("pass")}
              disabled={submitting || isAnimatingAway}
              accessibilityLabel="Ablehnen"
              icon={<Ionicons name="close" size={30} color={C.ink} />}
            />
            <Button
              size="icon"
              variant="danger"
              style={styles.like}
              onPress={() => handleTap("like")}
              disabled={submitting || isAnimatingAway}
              accessibilityLabel="Gefaellt mir"
              icon={<Ionicons name="heart" size={24} color={COURT_FIXED} />}
            />
          </View>
        </>
      ) : initialLoading ? (
        <CardSkeleton />
      ) : null}
    </ScrollView>
  );
}
