import { Pressable, Text } from "react-native";
import { useTheme } from "../theme";

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { styles } = useTheme();
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && { opacity: 0.8 }]}
      onPress={onPress}
    >
      <Text style={selected ? styles.selected : styles.chipText}>{label}</Text>
    </Pressable>
  );
}
