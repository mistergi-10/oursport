import { useState } from "react";
import { Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { SocialAuthButtons } from "../components/SocialAuthButtons";
import { useTheme } from "../theme";
import { authRequest } from "../lib/api";
import { levels, sports } from "../lib/constants";
import type { Profile } from "../lib/types";

export function SignupScreen({
  onAuthenticated,
  onSwitchToLogin,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
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
      setError("Bitte E-Mail und ein Passwort mit mind. 8 Zeichen angeben.");
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
      setError(caught instanceof Error ? caught.message : "Registrierung fehlgeschlagen");
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
          <Text style={styles.tagline}>
            Finde Trainingspartner in deiner Naehe. Sport macht zu zweit einfach
            mehr Spass.
          </Text>
        </View>
        <Text style={styles.title}>Konto erstellen</Text>
        <Text style={styles.helper}>
          Nur 3 kurze Schritte bis zu deinem ersten Match.
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
        />
        <Text style={styles.label}>Passwort</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Mind. 8 Zeichen"
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        <Text style={styles.label}>Name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Dein Vorname"
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>Ort</Text>
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder="z. B. Olten"
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>Deine Sportart</Text>
        <View style={styles.chips}>
          {sports.map((item) => (
            <Chip
              key={item}
              label={item}
              selected={sport === item}
              onPress={() => setSport(item)}
            />
          ))}
        </View>
        <Text style={styles.label}>Fitnesslevel</Text>
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
              <Text style={level === item ? styles.selected : styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? "Wird erstellt..." : "Konto erstellen"}
          onPress={save}
          disabled={submitting}
        />
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToLogin}>
          <Text style={styles.switchLink}>Ich habe schon ein Konto</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
