import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { SocialAuthButtons } from "../components/SocialAuthButtons";
import { useTheme } from "../theme";
import { authRequest, describeApiError } from "../lib/api";
import { levels, sports } from "../lib/constants";
import { translateLevel, translateSport } from "../lib/i18n";
import type { Profile } from "../lib/types";

export function SignupScreen({
  onAuthenticated,
  onSwitchToLogin,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [sport, setSport] = useState("Laufen");
  const [level, setLevel] = useState("Fortgeschritten");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const save = async () => {
    if (!email.trim() || password.length < 8) {
      setError(t("signup.validationError"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { token, profile } = await authRequest<{ token: string; profile: Profile }>(
        "/v1/auth/signup",
        {
          email: email.trim(),
          password,
          name: name.trim() || "Alex",
          city: city.trim() || "Olten",
          sport,
          level,
        },
      );
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
          <Text style={styles.tagline}>{t("welcome.tagline")}</Text>
        </View>
        <Text style={styles.title}>{t("signup.title")}</Text>
        <Text style={styles.helper}>{t("signup.helper")}</Text>
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
          placeholder={t("signup.passwordPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        <Text style={styles.label}>{t("signup.nameLabel")}</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("signup.namePlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>{t("signup.cityLabel")}</Text>
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder={t("signup.cityPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>{t("signup.sportLabel")}</Text>
        <View style={styles.chips}>
          {sports.map((item) => (
            <Chip
              key={item}
              label={translateSport(item)}
              selected={sport === item}
              onPress={() => setSport(item)}
            />
          ))}
        </View>
        <Text style={styles.label}>{t("signup.levelLabel")}</Text>
        <View style={styles.levels}>
          {levels.map((item) => (
            <Pressable
              key={item}
              style={({ pressed }) => [
                styles.level,
                level === item && styles.levelSelected,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => setLevel(item)}
            >
              <Text style={level === item ? styles.selected : styles.chipText}>{translateLevel(item)}</Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? t("signup.submitting") : t("signup.submit")}
          onPress={save}
          disabled={submitting}
        />
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToLogin}>
          <Text style={styles.switchLink}>{t("signup.switchToLogin")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
