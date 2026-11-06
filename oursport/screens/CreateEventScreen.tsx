import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useContext, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import { sports } from "../lib/constants";
import { translateSport } from "../lib/i18n";
import type { EventDetail } from "../lib/types";
import { useTheme } from "../theme";
import type { RootStackParamList } from "../navigation/types";

export function CreateEventScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "CreateEvent">) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const auth = useContext(AuthContext);
  const profile = useContext(ProfileContext);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(sports[0]);
  const [city, setCity] = useState(profile?.city ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [recurrence, setRecurrence] = useState<"none" | "weekly" | "biweekly">("none");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim() || !city.trim()) {
      setError(t("createEvent.validationTitleCity"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError(t("createEvent.validationDate"));
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time.trim())) {
      setError(t("createEvent.validationTime"));
      return;
    }
    const startsAt = new Date(`${date.trim()}T${time.trim()}:00`);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError(t("createEvent.validationFuture"));
      return;
    }
    const capacityNumber = Number(capacity);
    if (!Number.isInteger(capacityNumber) || capacityNumber < 2 || capacityNumber > 100) {
      setError(t("createEvent.validationCapacity"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest<EventDetail>("/v1/events", auth, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          sport,
          city: city.trim(),
          startsAt: startsAt.toISOString(),
          description: description.trim() || undefined,
          capacity: capacityNumber,
          recurrence: recurrence === "none" ? undefined : recurrence,
        }),
      });
      navigation.navigate("Main", { screen: "Events" });
    } catch (caught) {
      setError(describeApiError(caught, t("errors.generic")));
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
          accessibilityLabel={t("common.back")}
          icon={<Ionicons name="chevron-back" size={24} color={C.ink} />}
        />
        <Text style={styles.headerTitle}>{t("createEvent.headerTitle")}</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.setup}>
        <Text style={styles.label}>{t("createEvent.titleLabel")}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t("createEvent.titlePlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>{t("createEvent.sportLabel")}</Text>
        <View style={styles.chips}>
          {sports.map((item) => (
            <Chip key={item} label={translateSport(item)} selected={sport === item} onPress={() => setSport(item)} />
          ))}
        </View>
        <Text style={styles.label}>{t("createEvent.cityLabel")}</Text>
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder={t("createEvent.cityPlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>{t("createEvent.dateLabel")}</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder={t("createEvent.datePlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>{t("createEvent.timeLabel")}</Text>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder={t("createEvent.timePlaceholder")}
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>{t("createEvent.recurrenceLabel")}</Text>
        <View style={styles.chips}>
          <Chip label={t("createEvent.recurrenceNone")} selected={recurrence === "none"} onPress={() => setRecurrence("none")} />
          <Chip label={t("createEvent.recurrenceWeekly")} selected={recurrence === "weekly"} onPress={() => setRecurrence("weekly")} />
          <Chip label={t("createEvent.recurrenceBiweekly")} selected={recurrence === "biweekly"} onPress={() => setRecurrence("biweekly")} />
        </View>
        <Text style={styles.label}>{t("createEvent.descriptionLabel")}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t("createEvent.descriptionPlaceholder")}
          placeholderTextColor={C.mist}
          style={[styles.input, styles.multilineInput]}
          multiline
        />
        <Text style={styles.label}>{t("createEvent.capacityLabel")}</Text>
        <TextInput
          value={capacity}
          onChangeText={setCapacity}
          placeholder="10"
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="number-pad"
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Button
          label={submitting ? t("createEvent.submitting") : t("createEvent.submit")}
          onPress={submit}
          disabled={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
