import { Text, View } from "react-native";
import { useTheme } from "../theme";

export function BrandMark() {
  const { styles } = useTheme();
  return (
    <View style={styles.brandMark}>
      <Text style={styles.brandSymbol}>O</Text>
      <View style={styles.brandDot}>
        <Text>+</Text>
      </View>
    </View>
  );
}
