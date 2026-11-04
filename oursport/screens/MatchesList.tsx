import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useContext, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { Header } from "../components/Header";
import { RowSkeleton } from "../components/Skeleton";
import { AuthContext } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import { formatRelativeTime } from "../lib/format";
import type { ConversationSummary } from "../lib/types";
import { useTheme } from "../theme";
import type { RootStackParamList } from "../navigation/types";

export function MatchesList() {
  const { palette: C, styles } = useTheme();
  const matchAvatarColors = [C.ember, "#69B7EA", "#A98BEE"];
  const auth = useContext(AuthContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      apiRequest<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        "/v1/conversations",
        auth,
      )
        .then((response) => {
          if (cancelled) return;
          setConversationsList(response.conversations);
          setNextCursor(response.nextCursor);
        })
        .catch(() => {
          if (!cancelled) {
            setConversationsList([]);
            setNextCursor(null);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [auth.token, auth.userId]),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await apiRequest<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        `/v1/conversations?cursor=${encodeURIComponent(nextCursor)}`,
        auth,
      );
      setConversationsList((current) => [...current, ...response.conversations]);
      setNextCursor(response.nextCursor);
    } catch {
      // leave nextCursor as-is so the user can tap "Mehr laden" again
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Chats" />
      {loading ? (
        <>
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </>
      ) : conversationsList.length === 0 ? (
        <EmptyState
          icon="chatbubble-outline"
          title="Noch keine Matches"
          body="Sobald es ein Match gibt, taucht es hier auf."
        />
      ) : (
        <>
          {conversationsList.map((item, index) => (
            <Pressable
              style={styles.chatRow}
              key={item.conversationId}
              onPress={() =>
                navigation.navigate("Conversation", {
                  conversationId: item.conversationId,
                  name: item.name,
                  userId: item.userId,
                })
              }
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: matchAvatarColors[index % matchAvatarColors.length] },
                ]}
              >
                {item.photoUrl ? (
                  <Image source={{ uri: item.photoUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarLetter}>{item.name[0]?.toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.chatInfo}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={styles.chatPreview} numberOfLines={1}>
                  {item.lastMessage ? item.lastMessage.body : "Sag Hallo 👋"}
                </Text>
              </View>
              <View style={styles.chatMeta}>
                <Text style={styles.chatTime}>{formatRelativeTime(item.updatedAt)}</Text>
                {item.lastMessageReadByOther && (
                  <Ionicons name="checkmark-done" size={14} color={C.volt} />
                )}
              </View>
            </Pressable>
          ))}
          {nextCursor && (
            <Button
              variant="secondary"
              label="Mehr laden"
              loading={loadingMore}
              onPress={loadMore}
              disabled={loadingMore}
            />
          )}
        </>
      )}
    </ScrollView>
  );
}
