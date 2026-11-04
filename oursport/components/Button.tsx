import { Pressable, StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useTheme } from "../theme";
import { INK_FIXED, radius, spacing, typography } from "../theme/tokens";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type BaseProps = {
  variant?: ButtonVariant;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  // Overrides the variant's default text color/size — for call sites (e.g.
  // the event join button) whose color states don't map onto an existing
  // variant, instead of hand-rolling a separate Pressable.
  textColor?: string;
  textStyle?: StyleProp<TextStyle>;
};

type TextButtonProps = BaseProps & {
  size?: "default";
  label: string;
  loading?: boolean;
  accessibilityLabel?: string;
};

type IconButtonProps = BaseProps & {
  size: "icon";
  icon: React.ReactNode;
  // Required (not optional) so every icon-only Button call site is forced to
  // supply a screen-reader label — see acceptance criterion 8.
  accessibilityLabel: string;
};

type ButtonProps = TextButtonProps | IconButtonProps;

// Shared primary/secondary/danger/icon button: every variant uses the
// style-function form of Pressable so pressed state is always visually
// distinct (opacity + slight scale-down) instead of relying on the
// OS-default ripple/opacity.
export function Button(props: ButtonProps) {
  const { palette: C } = useTheme();
  const localStyles = useButtonStyles();
  const isIcon = props.size === "icon";
  const variant = props.variant ?? "primary";

  const variantStyle =
    variant === "primary"
      ? localStyles.primary
      : variant === "danger"
        ? localStyles.danger
        : variant === "ghost"
          ? localStyles.ghost
          : localStyles.secondary;
  const variantTextColor = props.textColor ?? (variant === "primary" ? C.volt : variant === "danger" ? C.court : C.ink);

  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled || (!isIcon && props.loading)}
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [
        isIcon ? localStyles.iconBase : localStyles.base,
        variantStyle,
        pressed && (isIcon ? localStyles.iconPressed : localStyles.pressed),
        props.disabled && localStyles.disabled,
        props.style,
      ]}
    >
      {isIcon ? (
        props.icon
      ) : (
        <Text style={[localStyles.text, props.textStyle, { color: variantTextColor }]}>
          {props.loading ? "\u2026" : props.label}
        </Text>
      )}
    </Pressable>
  );
}

function useButtonStyles() {
  const { palette: C } = useTheme();
  return StyleSheet.create({
    base: {
      borderRadius: radius.md,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.lg,
    },
    iconBase: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      alignItems: "center",
      justifyContent: "center",
    },
    primary: { backgroundColor: INK_FIXED },
    secondary: { borderWidth: 1, borderColor: C.line, backgroundColor: C.court },
    danger: { backgroundColor: C.ember },
    ghost: { backgroundColor: "transparent" },
    pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
    iconPressed: { opacity: 0.7, transform: [{ scale: 0.92 }] },
    disabled: { opacity: 0.5 },
    text: { fontSize: typography.body.fontSize, fontWeight: "800" },
  });
}
