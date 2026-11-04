import { Alert, View } from "react-native";
import { Button } from "./Button";
import { useTheme } from "../theme";

export function SocialAuthButtons() {
  const { styles } = useTheme();
  const notify = () => Alert.alert("Bald verfuegbar", "Login mit Google und Apple folgt in Kuerze.");
  return (
    <View style={styles.socialRow}>
      <Button variant="secondary" label="Mit Google fortfahren" onPress={notify} />
      <Button variant="secondary" label="Mit Apple fortfahren" onPress={notify} />
    </View>
  );
}
