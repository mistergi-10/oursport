import { Pressable, Text, View } from "react-native";
import { useTheme } from "../theme";

export function Checkbox({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  const { styles } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.checkboxRow, pressed && { opacity: 0.8 }]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked && <Text style={styles.checkboxMark}>✓</Text>}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}
