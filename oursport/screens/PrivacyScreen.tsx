import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setUnblockError(describeApiError(caught, t("errors.generic")));
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
        setDeleteError(t("errors.invalid_password"));
      } else {
        setDeleteError(describeApiError(caught, t("errors.generic")));
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
          accessibilityLabel={t("common.back")}
          icon={<Ionicons name="chevron-back" size={24} color={C.ink} />}
        />
        <Text style={styles.headerTitle}>{t("privacy.headerTitle")}</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.label}>{t("privacy.blockedUsers")}</Text>
        {loadingBlocks ? (
          <ActivityIndicator color={C.ink} />
        ) : blocksError ? (
          <Text style={styles.errorText}>{t("privacy.blockedLoadError")}</Text>
        ) : blockedList.length === 0 ? (
          <Text style={styles.helper}>{t("privacy.noBlockedUsers")}</Text>
        ) : (
          blockedList.map((item) => (
            <View style={styles.settings} key={item.userId}>
              <Text style={styles.settingsText}>{item.name}</Text>
              <Pressable
                onPress={() => void unblock(item.userId)}
                disabled={unblockingUserId === item.userId}
              >
                <Text style={[styles.settingsText, { color: C.ember }]}>
                  {unblockingUserId === item.userId ? t("privacy.unblocking") : t("privacy.unblock")}
                </Text>
              </Pressable>
            </View>
          ))
        )}
        {unblockError && <Text style={styles.errorText}>{unblockError}</Text>}
        <Text style={[styles.label, { marginTop: spacing.xxl }]}>{t("privacy.deleteAccountTitle")}</Text>
        <Text style={styles.helper}>{t("privacy.deleteAccountBody")}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={t("privacy.passwordPlaceholder")}
          placeholderTextColor={C.mist}
          style={[styles.input, { marginTop: spacing.md }]}
          secureTextEntry
        />
        <Checkbox
          checked={confirmed}
          onPress={() => setConfirmed((value) => !value)}
          label={t("privacy.confirmLabel")}
        />
        {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
        <Button
          variant="danger"
          label={deleting ? t("privacy.deleting") : t("privacy.deleteAccount")}
          onPress={() => void deleteAccount()}
          disabled={deleting || !password.trim() || !confirmed}
          style={{ marginTop: spacing.xl }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
