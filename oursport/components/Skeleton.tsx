import { useEffect } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useTheme } from "../theme";
import { radius, spacing } from "../theme/tokens";
import { useReducedMotion } from "../lib/reducedMotion";

// A single pulsing placeholder block. With reduced motion enabled it renders
// as a static (non-animated) muted block instead of pulsing.
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { palette: C } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 0.6 : 0.4);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 0.6;
      return;
    }
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 700 }), withTiming(0.4, { duration: 700 })),
      -1,
      true,
    );
  }, [reducedMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[{ backgroundColor: C.line, borderRadius: radius.sm }, style, animatedStyle]} />;
}

// Card-shaped skeleton standing in for the Matching swipe card / Events list
// card while their initial `loading` state is true.
export function CardSkeleton() {
  const { palette: C } = useTheme();
  return (
    <View style={{ backgroundColor: C.court, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
      <Skeleton style={{ height: 180, borderRadius: radius.md }} />
      <Skeleton style={{ height: 20, width: "60%" }} />
      <Skeleton style={{ height: 14, width: "40%" }} />
    </View>
  );
}

// Row-shaped skeleton standing in for a MatchesList chat row.
export function RowSkeleton() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md }}>
      <Skeleton style={{ width: 52, height: 52, borderRadius: radius.md }} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Skeleton style={{ height: 15, width: "50%" }} />
        <Skeleton style={{ height: 13, width: "80%" }} />
      </View>
    </View>
  );
}
