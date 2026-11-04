import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useContext, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { Checkbox } from "../components/Checkbox";
import { Chip } from "../components/Chip";
import { AuthContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import type { ReportReason } from "../lib/types";
import { useTheme } from "../theme";
import type { RootStackParamList } from "../navigation/types";

export function ReportScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Report">) {
  const { palette: C, styles } = useTheme();
  const { userId, name } = route.params;
  const auth = useContext(AuthContext);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reasons: { value: ReportReason; label: string }[] = [
    { value: "spam", label: "Spam" },
    { value: "harassment", label: "Belaestigung" },
    { value: "fake_profile", label: "Fake-Profil" },
    { value: "inappropriate_content", label: "Unangemessene Inhalte" },
    { value: "other", label: "Sonstiges" },
  ];

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/v1/reports", auth, {
        method: "POST",
        body: JSON.stringify({ userId, reason, note: note.trim() || undefined }),
      });
      if (alsoBlock) {
        await apiRequest("/v1/blocks", auth, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
      }
      navigation.goBack();
    } catch (caught) {
      setError(describeApiError(caught, "Meldung konnte nicht gesendet werden"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.conversationHeader}>
        <Button
          size="icon"
          variant="ghost"
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Zurueck"
          icon={<Ionicons name="chevron-back" size={24} color={C.ink} />}
        />
        <Text style={styles.headerTitle}>Melden</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.setup}>
        <Text style={styles.helper}>{name} melden</Text>
        <Text style={styles.label}>Grund</Text>
        <View style={styles.chips}>
          {reasons.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={reason === item.value}
              onPress={() => setReason(item.value)}
            />
          ))}
        </View>
        <Text style={styles.label}>Hinweis (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Weitere Details..."
          placeholderTextColor={C.mist}
          style={[styles.input, styles.multilineInput]}
          maxLength={1000}
          multiline
        />
        <Checkbox
          checked={alsoBlock}
          onPress={() => setAlsoBlock((value) => !value)}
          label="Nutzer zusaetzlich blockieren"
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? "Wird gesendet..." : "Melden"}
          onPress={() => void submit()}
          disabled={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
