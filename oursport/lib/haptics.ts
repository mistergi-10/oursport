import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// expo-haptics is native-only; every call site here no-ops silently on web
// instead of each screen having to check Platform.OS itself.
export function hapticImpact() {
  if (Platform.OS === "web") return;
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function hapticSuccess() {
  if (Platform.OS === "web") return;
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
