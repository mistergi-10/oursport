import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "./Button";
import { useTheme } from "../theme";

export function SocialAuthButtons() {
  const { styles } = useTheme();
  const { t } = useTranslation();
  const notify = () => Alert.alert(t("socialAuth.comingSoonTitle"), t("socialAuth.comingSoonBody"));
  return (
    <View style={styles.socialRow}>
      <Button variant="secondary" label={t("socialAuth.google")} onPress={notify} />
      <Button variant="secondary" label={t("socialAuth.apple")} onPress={notify} />
    </View>
  );
}
