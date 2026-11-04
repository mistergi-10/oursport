import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { elevation, radius } from "../theme/tokens";

// Shared card surface used by the swipe matchCard, event list card, and any
// future card-shaped content — centralizes the radius + elevation treatment
// so every card renders a visible shadow on iOS, Android, and web.
export function Card({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const { palette: C } = useTheme();
  const styles = StyleSheet.create({
    card: {
      backgroundColor: C.court,
      borderRadius: radius.lg,
      ...elevation(2),
    },
  });
  return <View style={[styles.card, style]}>{children}</View>;
}
