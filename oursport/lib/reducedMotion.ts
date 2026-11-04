import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// Checked once on mount and kept in sync via the change listener, per
// acceptance criterion: new animations skip/shorten themselves when the user
// has "reduce motion" enabled at the OS level (or `prefers-reduced-motion` on web).
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      setReduced(value);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
