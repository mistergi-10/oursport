import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useContext, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { AuthActionsContext, AuthContext } from "../context/AppContext";
import { apiRequest, ApiError, describeApiError } from "../lib/api";
import type { BlockedUser } from "../lib/types";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function PrivacyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Privacy">) {
  const { palette: C, styles } = useTheme();
  const auth = useContext(AuthContext);
  const { logout } = useContext(AuthActionsContext);
  const [blockedList, setBlockedList] = useState<BlockedUser[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [blocksError, setBlocksError] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBlocks = useCallback(async () => {
    setLoadingBlocks(true);
    setBlocksError(false);
    try {
      const response = await apiRequest<{ blocked: BlockedUser[] }>("/v1/blocks", auth);
      setBlockedList(response.blocked);
    } catch {
      setBlocksError(true);
    } finally {
      setLoadingBlocks(false);
    }
  }, [auth.token, auth.userId]);

  useFocusEffect(
    useCallback(() => {
      void loadBlocks();
    }, [loadBlocks]),
  );

  const unblock = async (userId: string) => {
    if (unblockingUserId) return;
    setUnblockingUserId(userId);
    setUnblockError(null);
    const previous = blockedList;
    setBlockedList((current) => current.filter((item) => item.userId !== userId));
    try {
      await apiRequest(`/v1/blocks/${userId}`, auth, { method: "DELETE" });
    } catch (caught) {
      setBlockedList(previous);
      setUnblockError(describeApiError(caught, "Entblocken fehlgeschlagen, bitte erneut versuchen"));
    } finally {
      setUnblockingUserId(null);
    }
  };

  const deleteAccount = async () => {
    if (!confirmed || !password.trim() || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiRequest("/v1/me", auth, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      logout();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setDeleteError("Passwort ist falsch.");
      } else {
        setDeleteError(describeApiError(caught, "Konto konnte nicht geloescht werden"));
      }
    } finally {
      setDeleting(false);
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
        <Text style={styles.headerTitle}>Daten & DSGVO</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.label}>Blockierte Nutzer</Text>
        {loadingBlocks ? (
          <ActivityIndicator color={C.ink} />
        ) : blocksError ? (
          <Text style={styles.errorText}>Blockierte Nutzer konnten nicht geladen werden.</Text>
        ) : blockedList.length === 0 ? (
          <Text style={styles.helper}>Keine blockierten Nutzer.</Text>
        ) : (
          blockedList.map((item) => (
            <View style={styles.settings} key={item.userId}>
              <Text style={styles.settingsText}>{item.name}</Text>
              <Pressable
                onPress={() => void unblock(item.userId)}
                disabled={unblockingUserId === item.userId}
              >
                <Text style={[styles.settingsText, { color: C.ember }]}>
                  {unblockingUserId === item.userId ? "..." : "Entblocken"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
        {unblockError && <Text style={styles.errorText}>{unblockError}</Text>}
        <Text style={[styles.label, { marginTop: spacing.xxl }]}>Konto loeschen</Text>
        <Text style={styles.helper}>
          Diese Aktion ist endgueltig. Dein Profil wird anonymisiert, bestehende Matches,
          Chats und Events bleiben fuer andere Nutzer sichtbar.
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Passwort"
          placeholderTextColor={C.mist}
          style={[styles.input, { marginTop: spacing.md }]}
          secureTextEntry
        />
        <Checkbox
          checked={confirmed}
          onPress={() => setConfirmed((value) => !value)}
          label="Ich verstehe, dass die Loeschung endgueltig ist."
        />
        {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
        <Button
          variant="danger"
          label={deleting ? "Wird geloescht..." : "Konto endgueltig loeschen"}
          onPress={() => void deleteAccount()}
          disabled={deleting || !password.trim() || !confirmed}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
