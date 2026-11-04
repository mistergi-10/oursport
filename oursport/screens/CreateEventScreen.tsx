import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useContext, useState } from "react";
import { SafeAreaView, ScrollView, Text, TextInput, View } from "react-native";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import { sports } from "../lib/constants";
import type { EventDetail } from "../lib/types";
import { useTheme } from "../theme";
import type { RootStackParamList } from "../navigation/types";

export function CreateEventScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "CreateEvent">) {
  const { palette: C, styles } = useTheme();
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
      setError("Bitte Titel und Ort angeben.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      setError("Datum im Format JJJJ-MM-TT angeben.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time.trim())) {
      setError("Uhrzeit im Format HH:mm angeben.");
      return;
    }
    const startsAt = new Date(`${date.trim()}T${time.trim()}:00`);
    if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setError("Datum/Uhrzeit muss in der Zukunft liegen.");
      return;
    }
    const capacityNumber = Number(capacity);
    if (!Number.isInteger(capacityNumber) || capacityNumber < 2 || capacityNumber > 100) {
      setError("Kapazitaet muss zwischen 2 und 100 liegen.");
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
      setError(describeApiError(caught, caught instanceof Error ? caught.message : "Event konnte nicht erstellt werden"));
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
        <Text style={styles.headerTitle}>Event erstellen</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.setup}>
        <Text style={styles.label}>Titel</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="z. B. Lauftreff am Fluss"
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>Sportart</Text>
        <View style={styles.chips}>
          {sports.map((item) => (
            <Chip key={item} label={item} selected={sport === item} onPress={() => setSport(item)} />
          ))}
        </View>
        <Text style={styles.label}>Ort</Text>
        <TextInput
          value={city}
          onChangeText={setCity}
          placeholder="z. B. Olten"
          placeholderTextColor={C.mist}
          style={styles.input}
        />
        <Text style={styles.label}>Datum (JJJJ-MM-TT)</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="2026-11-01"
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>Uhrzeit (HH:mm)</Text>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="18:00"
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="numbers-and-punctuation"
        />
        <Text style={styles.label}>Wiederholung</Text>
        <View style={styles.chips}>
          <Chip label="Einmalig" selected={recurrence === "none"} onPress={() => setRecurrence("none")} />
          <Chip label="Woechentlich" selected={recurrence === "weekly"} onPress={() => setRecurrence("weekly")} />
          <Chip label="Alle 2 Wochen" selected={recurrence === "biweekly"} onPress={() => setRecurrence("biweekly")} />
        </View>
        <Text style={styles.label}>Beschreibung (optional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Details zum Treffpunkt, Pace, etc."
          placeholderTextColor={C.mist}
          style={[styles.input, styles.multilineInput]}
          multiline
        />
        <Text style={styles.label}>Kapazitaet (2-100)</Text>
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
          label={submitting ? "Wird erstellt..." : "Event erstellen"}
          onPress={submit}
          disabled={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
