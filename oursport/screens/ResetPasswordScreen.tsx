import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useTheme } from "../theme";
import { authRequest, describeApiError } from "../lib/api";

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
  const { t } = useTranslation();
  const [emailValue, setEmailValue] = useState(email);
  const [code, setCode] = useState(devCode ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError(t("resetPassword.codeValidationError"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("resetPassword.passwordValidationError"));
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
          <Text style={styles.tagline}>{t("resetPassword.tagline")}</Text>
        </View>
        <Text style={styles.title}>{t("resetPassword.title")}</Text>
        <Text style={styles.label}>{t("common.emailLabel")}</Text>
        <TextInput
          value={emailValue}
          onChangeText={setEmailValue}
          placeholder={t("common.emailPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>{t("resetPassword.codeLabel")}</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={t("resetPassword.codePlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="number-pad"
          maxLength={6}
        />
        <Text style={styles.label}>{t("resetPassword.newPasswordLabel")}</Text>
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder={t("resetPassword.newPasswordPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? t("resetPassword.submitting") : t("resetPassword.submit")}
          onPress={confirm}
          disabled={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
