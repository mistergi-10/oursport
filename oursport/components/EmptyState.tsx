import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "./Button";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";

// Shared "no data"/error render used by Matching, MatchesList, Events,
// EventDetailScreen, and ConversationScreen — always a title + body line,
// plus a retry button for every state that previously offered one.
export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const localStyles = StyleSheet.create({
    icon: { marginBottom: spacing.sm },
    action: { marginTop: spacing.lg, alignSelf: "stretch" },
  });
  return (
    <View style={styles.empty}>
      {icon && <Ionicons name={icon} size={36} color={C.mist} style={localStyles.icon} />}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.helper}>{body}</Text>
      {actionLabel && onAction && (
        <Button variant="secondary" label={actionLabel} onPress={onAction} style={localStyles.action} />
      )}
    </View>
  );
}
