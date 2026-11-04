import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { SocialAuthButtons } from "../components/SocialAuthButtons";
import { useTheme } from "../theme";
import { authRequest } from "../lib/api";
import type { Profile } from "../lib/types";

export function LoginScreen({
  onAuthenticated,
  onSwitchToSignup,
  onForgotPassword,
  successMessage,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToSignup: () => void;
  onForgotPassword: () => void;
  successMessage?: string;
}) {
  const { palette: C, styles } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const login = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { token, profile } = await authRequest<{ token: string; profile: Profile | null }>(
        "/v1/auth/login",
        { email: email.trim(), password },
      );
      if (!profile) throw new Error("Kein Profil gefunden");
      await onAuthenticated(token, profile);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen");
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
          <Text style={styles.tagline}>Schoen, dich wiederzusehen.</Text>
        </View>
        <Text style={styles.title}>Anmelden</Text>
        {successMessage && <Text style={styles.helper}>{successMessage}</Text>}
        <Text style={styles.label}>E-Mail</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="du@beispiel.ch"
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>Passwort</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Dein Passwort"
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        <Pressable onPress={onForgotPassword}>
          <Text style={styles.switchLink}>Passwort vergessen?</Text>
        </Pressable>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? "Wird geprueft..." : "Anmelden"}
          onPress={login}
          disabled={submitting}
        />
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToSignup}>
          <Text style={styles.switchLink}>Neues Konto erstellen</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
