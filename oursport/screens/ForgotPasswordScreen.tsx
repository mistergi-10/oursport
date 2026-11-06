import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useTheme } from "../theme";
import { authRequest, describeApiError } from "../lib/api";

export function ForgotPasswordScreen({
  onCodeRequested,
  onBackToLogin,
}: {
  onCodeRequested: (email: string, devCode?: string) => void;
  onBackToLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>(undefined);

  const requestCode = async () => {
    if (!email.trim()) {
      setError(t("forgotPassword.validationError"));
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
          <Text style={styles.tagline}>{t("forgotPassword.tagline")}</Text>
        </View>
        <Text style={styles.title}>{t("forgotPassword.title")}</Text>
        <Text style={styles.helper}>{t("forgotPassword.helper")}</Text>
        <Text style={styles.label}>{t("common.emailLabel")}</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder={t("common.emailPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          editable={!sent}
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        {sent ? (
          <>
            <Text style={styles.helper}>{t("forgotPassword.sentHelper")}</Text>
            <Button label={t("forgotPassword.enterCode")} onPress={() => onCodeRequested(email.trim(), devCode)} />
          </>
        ) : (
          <Button
            label={submitting ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
            onPress={requestCode}
            disabled={submitting}
          />
        )}
        <Pressable onPress={onBackToLogin}>
          <Text style={styles.switchLink}>{t("forgotPassword.backToLogin")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
