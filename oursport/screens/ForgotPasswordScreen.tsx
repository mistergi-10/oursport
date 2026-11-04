import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useTheme } from "../theme";
import { authRequest } from "../lib/api";

export function ForgotPasswordScreen({
  onCodeRequested,
  onBackToLogin,
}: {
  onCodeRequested: (email: string, devCode?: string) => void;
  onBackToLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>(undefined);

  const requestCode = async () => {
    if (!email.trim()) {
      setError("Bitte eine E-Mail-Adresse angeben.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await authRequest<{ status: string; resetCode?: string }>(
        "/v1/auth/password-reset/request",
        { email: email.trim() },
      );
      setDevCode(response.resetCode);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Anfrage fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.setup}>
        <View style={styles.hero}>
          <BrandMark />
          <Text style={styles.wordmark}>Our Sport</Text>
          <Text style={styles.tagline}>Passwort zuruecksetzen</Text>
        </View>
        <Text style={styles.title}>Passwort vergessen?</Text>
        <Text style={styles.helper}>
          Gib deine E-Mail ein, wir schicken dir einen Code zum Zuruecksetzen.
        </Text>
        <Text style={styles.label}>E-Mail</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="du@beispiel.ch"
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!sent}
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        {sent ? (
          <>
            <Text style={styles.helper}>
              Falls die E-Mail existiert, haben wir dir einen Code geschickt.
              Pruefe dein Postfach.
            </Text>
            <Button label="Code eingeben" onPress={() => onCodeRequested(email.trim(), devCode)} />
          </>
        ) : (
          <Button
            label={submitting ? "Wird gesendet..." : "Code senden"}
            onPress={requestCode}
            disabled={submitting}
          />
        )}
        <Pressable onPress={onBackToLogin}>
          <Text style={styles.switchLink}>Zurueck zur Anmeldung</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
