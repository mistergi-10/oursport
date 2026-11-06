import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { useTheme } from "../theme";

export function Header({
  title,
  actionIcon = "options-outline",
  actionAccessibilityLabel,
  onAction,
  accentColor = "ink",
}: {
  title: string;
  actionIcon?: keyof typeof Ionicons.glyphMap;
  actionAccessibilityLabel?: string;
  onAction?: () => void;
  // Per-tab accent (Matching -> volt, Events -> ember, Profile -> mist);
  // "ink" (the default) renders identically to before this prop existed.
  accentColor?: "ink" | "volt" | "ember" | "mist";
}) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const accent = C[accentColor];
  return (
    <View style={styles.header}>
      <View style={styles.headerTitleGroup}>
        <Text style={styles.headerTitle}>{title}</Text>
        {accentColor !== "ink" && <View style={[styles.headerAccent, { backgroundColor: accent }]} />}
      </View>
      <Button
        size="icon"
        variant="secondary"
        style={styles.filter}
        onPress={onAction}
        accessibilityLabel={actionAccessibilityLabel ?? t("header.filter")}
        icon={<Ionicons name={actionIcon} size={18} color={accent} />}
      />
    </View>
  );
}
