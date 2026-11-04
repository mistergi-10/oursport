import { useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useTheme } from "../theme";
import { authRequest } from "../lib/api";

export function ResetPasswordScreen({
  email,
  devCode,
  onSuccess,
}: {
  email: string;
  devCode?: string;
  onSuccess: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const [emailValue, setEmailValue] = useState(email);
  const [code, setCode] = useState(devCode ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Bitte den 6-stelligen Code eingeben.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Das neue Passwort braucht mind. 8 Zeichen.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await authRequest<{ status: string }>("/v1/auth/password-reset/confirm", {
        email: emailValue.trim(),
        code,
        newPassword,
      });
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zuruecksetzen fehlgeschlagen");
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
          <Text style={styles.tagline}>Neues Passwort festlegen</Text>
        </View>
        <Text style={styles.title}>Code eingeben</Text>
        <Text style={styles.label}>E-Mail</Text>
        <TextInput
          value={emailValue}
          onChangeText={setEmailValue}
          placeholder="du@beispiel.ch"
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>Code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-stelliger Code"
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="number-pad"
          maxLength={6}
        />
        <Text style={styles.label}>Neues Passwort</Text>
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Mind. 8 Zeichen"
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? "Wird gespeichert..." : "Passwort speichern"}
          onPress={confirm}
          disabled={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
