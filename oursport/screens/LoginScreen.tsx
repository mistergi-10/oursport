import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { SocialAuthButtons } from "../components/SocialAuthButtons";
import { useTheme } from "../theme";
import { authRequest, describeApiError } from "../lib/api";
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
  const { t } = useTranslation();
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
      if (!profile) {
        setError(t("errors.no_profile"));
        return;
      }
      await onAuthenticated(token, profile);
    } catch (caught) {
      setError(describeApiError(caught, t("errors.generic")));
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
          <Text style={styles.tagline}>{t("login.subtitle")}</Text>
        </View>
        <Text style={styles.title}>{t("login.title")}</Text>
        {successMessage && <Text style={styles.helper}>{successMessage}</Text>}
        <Text style={styles.label}>{t("common.emailLabel")}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("common.emailPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>{t("common.passwordLabel")}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={t("login.passwordPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        <Pressable onPress={onForgotPassword}>
          <Text style={styles.switchLink}>{t("login.forgotPassword")}</Text>
        </Pressable>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? t("login.submitting") : t("login.submit")}
          onPress={login}
          disabled={submitting}
        />
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToSignup}>
          <Text style={styles.switchLink}>{t("login.switchToSignup")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
