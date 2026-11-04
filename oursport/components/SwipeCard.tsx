import { forwardRef, useCallback, useImperativeHandle } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useReducedMotion } from "../lib/reducedMotion";

export type SwipeDirection = "left" | "right";
export type SwipeCardHandle = { flyOff: (direction: SwipeDirection) => void };

const SWIPE_THRESHOLD = 120;
const FLY_OFF_DISTANCE = 500;

// Draggable "Tinder-style" card: drag left/right past SWIPE_THRESHOLD flies
// the card off-screen and reports the direction; releasing before the
// threshold snaps back to center. `flyOff` is exposed via ref so the existing
// tap pass/like buttons can trigger the identical animation programmatically.
export const SwipeCard = forwardRef<
  SwipeCardHandle,
  {
    children: React.ReactNode;
    style?: StyleProp<ViewStyle>;
    onSwiped: (direction: SwipeDirection) => void;
    // Fired the instant a swipe is committed (threshold crossed or `flyOff`
    // called), before the fly-off animation finishes — lets callers disable
    // further interaction immediately instead of waiting out the animation.
    onCommit?: (direction: SwipeDirection) => void;
    disabled?: boolean;
  }
>(({ children, style, onSwiped, onCommit, disabled }, ref) => {
  const reducedMotion = useReducedMotion();
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const flyDuration = reducedMotion ? 120 : 260;

  const animateOff = useCallback(
    (direction: SwipeDirection) => {
      onCommit?.(direction);
      const toX = direction === "left" ? -FLY_OFF_DISTANCE : FLY_OFF_DISTANCE;
      translateX.value = withTiming(toX, { duration: flyDuration }, (finished) => {
        if (finished) runOnJS(onSwiped)(direction);
      });
    },
    [flyDuration, onCommit, onSwiped, translateX],
  );

  useImperativeHandle(ref, () => ({ flyOff: animateOff }), [animateOff]);

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onUpdate((event) => {
      translateX.value = event.translationX;
      translateY.value = event.translationY;
    })
    .onEnd((event) => {
      if (Math.abs(event.translationX) > SWIPE_THRESHOLD) {
        const direction: SwipeDirection = event.translationX > 0 ? "right" : "left";
        if (onCommit) runOnJS(onCommit)(direction);
        const toX = direction === "left" ? -FLY_OFF_DISTANCE : FLY_OFF_DISTANCE;
        translateX.value = withTiming(toX, { duration: flyDuration }, (finished) => {
          if (finished) runOnJS(onSwiped)(direction);
        });
      } else {
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });


  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: `${translateX.value / 20}deg` },
    ],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
});
SwipeCard.displayName = "SwipeCard";
