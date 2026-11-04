import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MotiView } from "moti";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest, ApiError, describeApiError, getWebSocketUrl } from "../lib/api";
import { formatMessageTime, MAX_POLL_PAGES } from "../lib/format";
import { hapticSuccess } from "../lib/haptics";
import { useReducedMotion } from "../lib/reducedMotion";
import type { ConversationMessage } from "../lib/types";
import { useTheme } from "../theme";
import type { RootStackParamList } from "../navigation/types";

// Default polling cadence (socket unavailable/erroring) vs. the relaxed
// cadence once the websocket confirms it's open and doing the real-time work.
const POLL_INTERVAL_FALLBACK_MS = 4000;
const POLL_INTERVAL_WITH_SOCKET_MS = 18000;

export function ConversationScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Conversation">) {
  const { palette: C, styles } = useTheme();
  const reducedMotion = useReducedMotion();
  const { conversationId, name, userId: otherUserId } = route.params;
  const auth = useContext(AuthContext);
  const profile = useContext(ProfileContext);
  const [messagesList, setMessagesList] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const messageIdsRef = useRef<Set<string>>(new Set());
  // Tracks which message ids have already played their entrance animation, so
  // a poll-triggered re-render of already-seen bubbles doesn't replay it.
  const animatedMessageIdsRef = useRef<Set<string>>(new Set());
  const unavailableRef = useRef(false);
  // Mutated by the socket's onopen/onclose/onerror handlers so the polling
  // loop below can relax/restore its cadence without recreating the timer.
  const pollDelayRef = useRef(POLL_INTERVAL_FALLBACK_MS);

  // Marks newly-rendered messages as "seen" after commit rather than during
  // render — mutating a ref mid-render is unsafe under React's render purity
  // rules (e.g. would mis-fire `isNew` if a render pass ever runs twice).
  useEffect(() => {
    for (const message of messagesList) {
      animatedMessageIdsRef.current.add(message.messageId);
    }
  }, [messagesList]);

  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const markRead = useCallback(() => {
    apiRequest(`/v1/conversations/${conversationId}/read`, auth, { method: "POST" }).catch(() => {
      // best-effort; a missed read receipt isn't worth surfacing to the user
    });
  }, [auth.token, auth.userId, conversationId]);

  // Shared with the websocket's incoming "message" events, merging them into
  // the list the same way a polled message is merged (dedupe by messageId).
  const mergeIncomingMessage = useCallback((message: ConversationMessage) => {
    if (messageIdsRef.current.has(message.messageId)) return;
    messageIdsRef.current.add(message.messageId);
    setMessagesList((current) => sortMessages([...current, message]));
  }, []);

  function sortMessages(list: ConversationMessage[]) {
    return [...list].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.messageId < b.messageId ? -1 : 1;
    });
  }

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ messages: ConversationMessage[]; nextCursor: string | null }>(
        `/v1/conversations/${conversationId}/messages`,
        auth,
      );
      const ordered = sortMessages(response.messages);
      setMessagesList(ordered);
      messageIdsRef.current = new Set(ordered.map((message) => message.messageId));
      // Existing history on load is already "seen" — only messages that
      // arrive afterwards (send/poll) should play the entrance animation.
      animatedMessageIdsRef.current = new Set(messageIdsRef.current);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        markUnavailable();
      } else {
        setMessagesList([]);
        messageIdsRef.current = new Set();
      }
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, conversationId, markUnavailable]);

  // Keeps paging through older messages (via nextCursor) until it reaches one
  // already held locally, so a burst of >1 page of messages between polls isn't
  // silently dropped; merges purely by messageId rather than a createdAt
  // comparison so same-millisecond messages from different senders can't collide.
  // Bounded by MAX_POLL_PAGES so a cursor that never resolves to null (server bug)
  // or a message rate that outpaces paging can't turn this into an infinite loop.
  const poll = useCallback(async () => {
    if (unavailableRef.current) return;
    try {
      const known = messageIdsRef.current;
      const collected: ConversationMessage[] = [];
      let cursor: string | null = null;
      let reachedKnown = false;
      for (let page = 0; page < MAX_POLL_PAGES; page += 1) {
        const path: string = cursor
          ? `/v1/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`
          : `/v1/conversations/${conversationId}/messages`;
        const response = await apiRequest<{ messages: ConversationMessage[]; nextCursor: string | null }>(
          path,
          auth,
        );
        for (const message of response.messages) {
          if (known.has(message.messageId)) {
            reachedKnown = true;
            break;
          }
          collected.push(message);
        }
        if (reachedKnown || !response.nextCursor) break;
        cursor = response.nextCursor;
      }

      if (collected.length === 0) return;
      setMessagesList((current) => {
        const currentIds = new Set(current.map((message) => message.messageId));
        const additions = collected.filter((message) => !currentIds.has(message.messageId));
        if (additions.length === 0) return current;
        const merged = sortMessages([...current, ...additions]);
        messageIdsRef.current = new Set(merged.map((message) => message.messageId));
        return merged;
      });
    } catch (caught) {
      // a 404 (e.g. the other side just blocked us) stops polling; other
      // transient errors are swallowed since the next tick may succeed
      if (caught instanceof ApiError && caught.status === 404) markUnavailable();
    }
  }, [auth.token, auth.userId, conversationId, markUnavailable]);

  useFocusEffect(
    useCallback(() => {
      void loadInitial();
      markRead();
      pollDelayRef.current = POLL_INTERVAL_FALLBACK_MS;

      // Real-time channel: the websocket only ever pushes already-persisted
      // messages (sending stays REST-only); polling below keeps working as a
      // fallback regardless of whether the socket ever connects.
      const wsUrl = getWebSocketUrl("/v1/ws", auth);
      const socket = wsUrl ? new WebSocket(wsUrl) : null;
      if (socket) {
        socket.onopen = () => {
          pollDelayRef.current = POLL_INTERVAL_WITH_SOCKET_MS;
        };
        socket.onerror = () => {
          pollDelayRef.current = POLL_INTERVAL_FALLBACK_MS;
        };
        socket.onclose = () => {
          pollDelayRef.current = POLL_INTERVAL_FALLBACK_MS;
        };
        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(String(event.data)) as {
              type?: string;
              conversationId?: string;
              message?: ConversationMessage;
            };
            if (data.type === "message" && data.conversationId === conversationId && data.message) {
              mergeIncomingMessage(data.message);
            }
          } catch {
            // ignore malformed frames
          }
        };
      }

      // Guards against overlapping ticks if a poll (e.g. a slow response, or the
      // multi-page catch-up loop above) takes longer than the interval itself.
      // Uses a self-rescheduling setTimeout (rather than setInterval) so the
      // socket's onopen/onclose handlers above can relax/restore the cadence
      // without tearing down and recreating the timer.
      let pollInFlight = false;
      let stopped = false;
      let timeoutId: ReturnType<typeof setTimeout>;
      const scheduleNext = () => {
        if (stopped) return;
        timeoutId = setTimeout(runPoll, pollDelayRef.current);
      };
      const runPoll = () => {
        if (unavailableRef.current) {
          stopped = true;
          return;
        }
        if (pollInFlight) {
          scheduleNext();
          return;
        }
        pollInFlight = true;
        void poll().finally(() => {
          pollInFlight = false;
          markRead();
          scheduleNext();
        });
      };
      scheduleNext();

      return () => {
        stopped = true;
        clearTimeout(timeoutId);
        socket?.close();
      };
    }, [loadInitial, poll, markRead, auth, conversationId, mergeIncomingMessage]),
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || body.length > 2000 || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await apiRequest<ConversationMessage>(
        `/v1/conversations/${conversationId}/messages`,
        auth,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      setMessagesList((current) => [...current, message]);
      messageIdsRef.current.add(message.messageId);
      setDraft("");
      hapticSuccess();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        markUnavailable();
      } else {
        setError(describeApiError(caught, caught instanceof Error ? caught.message : "Senden fehlgeschlagen"));
      }
    } finally {
      setSending(false);
    }
  };

  const blockConversationPartner = async () => {
    setError(null);
    try {
      await apiRequest("/v1/blocks", auth, {
        method: "POST",
        body: JSON.stringify({ userId: otherUserId }),
      });
      navigation.navigate("Main", { screen: "Chats" });
    } catch (caught) {
      setError(describeApiError(caught, "Blockieren fehlgeschlagen, bitte erneut versuchen"));
    }
  };

  const confirmBlockPartner = () => {
    Alert.alert(`${name} blockieren?`, "Die Unterhaltung wird danach nicht mehr angezeigt.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => void blockConversationPartner() },
    ]);
  };

  const openMenu = () => {
    Alert.alert(name, undefined, [
      {
        text: "Melden",
        onPress: () => navigation.navigate("Report", { userId: otherUserId, name }),
      },
      { text: "Blockieren", style: "destructive", onPress: confirmBlockPartner },
      { text: "Abbrechen", style: "cancel" },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.conversationHeader}>
          <Button
            size="icon"
            variant="ghost"
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            accessibilityLabel="Zurueck"
            icon={<Ionicons name="chevron-back" size={24} color={C.ink} />}
          />
          <Text style={styles.headerTitle}>{name}</Text>
          <Button
            size="icon"
            variant="ghost"
            style={styles.backButton}
            onPress={openMenu}
            disabled={unavailable}
            accessibilityLabel="Weitere Optionen"
            icon={!unavailable ? <Ionicons name="ellipsis-horizontal" size={18} color={C.ink} /> : null}
          />
        </View>
        {unavailable ? (
          <EmptyState
            icon="alert-circle-outline"
            title="Nicht mehr verfuegbar"
            body="Diese Unterhaltung ist nicht mehr verfuegbar."
            actionLabel="Zurueck zu den Chats"
            onAction={() => navigation.navigate("Main", { screen: "Chats" })}
          />
        ) : loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={C.ink} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.messageList}>
            {messagesList.length === 0 ? (
              <EmptyState title="Sag Hallo 👋" body="Schreib die erste Nachricht." />
            ) : (
              messagesList.map((message) => {
                const isNew = !animatedMessageIdsRef.current.has(message.messageId);
                return (
                  <MotiView
                    key={message.messageId}
                    from={isNew && !reducedMotion ? { opacity: 0, translateY: 8 } : undefined}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: "timing", duration: reducedMotion ? 0 : 220 }}
                    style={[
                      styles.messageBubble,
                      message.senderUserId === profile?.userId
                        ? styles.messageBubbleOwn
                        : styles.messageBubbleOther,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        message.senderUserId === profile?.userId && styles.messageTextOwn,
                      ]}
                    >
                      {message.body}
                    </Text>
                    <Text style={styles.messageTime}>{formatMessageTime(message.createdAt)}</Text>
                  </MotiView>
                );
              })
            )}
          </ScrollView>
        )}
        {!unavailable && error && <Text style={styles.errorText}>{error}</Text>}
        {!unavailable && (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Nachricht schreiben..."
              placeholderTextColor={C.mist}
              style={styles.composerInput}
              maxLength={2000}
              multiline
            />
            <Button
              size="icon"
              style={styles.sendButton}
              onPress={send}
              disabled={sending || !draft.trim()}
              accessibilityLabel="Senden"
              icon={
                sending ? (
                  <ActivityIndicator color={C.volt} size="small" />
                ) : (
                  <Ionicons name="send" size={18} color={C.volt} />
                )
              }
            />
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
