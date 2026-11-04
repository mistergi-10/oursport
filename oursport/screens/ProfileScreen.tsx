import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useContext, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Header } from "../components/Header";
import { AuthActionsContext, AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest } from "../lib/api";
import { disablePushNotifications, enablePushNotifications, getExistingPushSubscription, isPushSupported } from "../lib/push";
import type { Profile } from "../lib/types";
import { useTheme } from "../theme";
import { COURT_FIXED, spacing } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function ProfileScreen() {
  const { palette: C, styles, scheme, toggleScheme } = useTheme();
  const profile = useContext(ProfileContext);
  const auth = useContext(AuthContext);
  const { logout, updateProfile } = useContext(AuthActionsContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [locatingBusy, setLocatingBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const pushSupported = isPushSupported();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationsBusy, setNotificationsBusy] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  useEffect(() => {
    if (!pushSupported) return;
    let active = true;
    void getExistingPushSubscription().then((subscription) => {
      if (active) setNotificationsEnabled(Boolean(subscription));
    });
    return () => {
      active = false;
    };
  }, [pushSupported]);

  const toggleNotifications = async (value: boolean) => {
    if (notificationsBusy) return;
    setNotificationsBusy(true);
    setNotificationsError(null);
    try {
      if (value) {
        await enablePushNotifications(auth);
      } else {
        await disablePushNotifications(auth);
      }
      setNotificationsEnabled(value);
    } catch (error) {
      setNotificationsError(
        error instanceof Error ? error.message : "Benachrichtigungen konnten nicht geaendert werden.",
      );
    } finally {
      setNotificationsBusy(false);
    }
  };

  if (!profile) return null;

  const pickPhoto = async () => {
    if (uploadingPhoto) return;
    setPhotoError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError("Zugriff auf Fotos wurde nicht erlaubt.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    const photoUrl = `data:image/jpeg;base64,${result.assets[0].base64}`;
    if (photoUrl.length > 350_000) {
      setPhotoError("Foto ist zu gross, bitte ein kleineres Bild waehlen.");
      return;
    }
    setUploadingPhoto(true);
    try {
      const updated = await apiRequest<Profile>("/v1/me", auth, {
        method: "PATCH",
        body: JSON.stringify({
          name: profile.name,
          city: profile.city,
          sport: profile.sport,
          level: profile.level,
          photoUrl,
        }),
      });
      updateProfile(updated);
    } catch {
      setPhotoError("Foto konnte nicht gespeichert werden.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const useCurrentLocation = async () => {
    if (locatingBusy) return;
    setLocationError(null);
    setLocatingBusy(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationError("Zugriff auf den Standort wurde nicht erlaubt.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const updated = await apiRequest<Profile>("/v1/me", auth, {
        method: "PATCH",
        body: JSON.stringify({
          name: profile.name,
          city: profile.city,
          sport: profile.sport,
          level: profile.level,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
      });
      updateProfile(updated);
    } catch {
      setLocationError("Standort konnte nicht ermittelt werden.");
    } finally {
      setLocatingBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Profil" accentColor="mist" />
      <View style={styles.profileHead}>
        <Pressable
          onPress={() => void pickPhoto()}
          disabled={uploadingPhoto}
          accessibilityRole="button"
          accessibilityLabel="Profilfoto aendern"
        >
          <View style={styles.profileAvatar}>
            {profile.photoUrl ? (
              <Image source={{ uri: profile.photoUrl }} style={styles.profileAvatarImage} />
            ) : (
              <Text style={styles.profileInitial}>
                {profile.name[0]?.toUpperCase()}
              </Text>
            )}
            {uploadingPhoto ? (
              <View style={styles.profilePhotoBadge}>
                <ActivityIndicator color={COURT_FIXED} size="small" />
              </View>
            ) : (
              <View style={styles.profilePhotoBadge}>
                <Ionicons name="camera" size={14} color={COURT_FIXED} />
              </View>
            )}
          </View>
        </Pressable>
        <Text style={styles.profileName}>{profile.name}</Text>
        <Text style={styles.profileSub}>
          {profile.city} · {profile.sport}
        </Text>
        {photoError && <Text style={styles.errorText}>{photoError}</Text>}
      </View>
      <Text style={styles.label}>Darstellung</Text>
      <View style={styles.settings}>
        <Text style={styles.settingsText}>Dunkles Design</Text>
        <Switch
          value={scheme === "dark"}
          onValueChange={toggleScheme}
          trackColor={{ true: C.volt, false: C.line }}
          thumbColor={COURT_FIXED}
        />
      </View>
      <Text style={styles.label}>Benachrichtigungen</Text>
      <View style={styles.settings}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.settingsText}>Push-Benachrichtigungen</Text>
          <Text style={styles.helper}>
            {pushSupported
              ? "Erhalte Hinweise zu Matches, Nachrichten und freien Event-Plaetzen."
              : "Nur in der Web-App verfuegbar. Native Push folgt in einer spaeteren Version."}
          </Text>
          {notificationsError && <Text style={styles.errorText}>{notificationsError}</Text>}
        </View>
        {notificationsBusy ? (
          <ActivityIndicator color={C.ink} />
        ) : (
          <Switch
            value={notificationsEnabled}
            onValueChange={(value) => void toggleNotifications(value)}
            disabled={!pushSupported}
            trackColor={{ true: C.volt, false: C.line }}
            thumbColor={COURT_FIXED}
          />
        )}
      </View>
      <Text style={styles.label}>Konto</Text>
      {[
        "Persoenliche Angaben",
        "Sportarten & Level",
        "Verfuegbarkeit",
      ].map((item) => (
        <Pressable
          style={styles.settings}
          key={item}
          onPress={() => Alert.alert("Bald verfuegbar", `${item} folgt in Kuerze.`)}
        >
          <Text style={styles.settingsText}>{item}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.mist} />
        </Pressable>
      ))}
      <Pressable style={styles.settings} onPress={() => void useCurrentLocation()} disabled={locatingBusy}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.settingsText}>Standort verwenden</Text>
          <Text style={styles.helper}>
            {profile.latitude != null && profile.longitude != null
              ? "Aktueller Standort ist gespeichert. Tippen zum Aktualisieren."
              : "Nutze deinen aktuellen Standort fuer bessere Vorschlaege in der Naehe."}
          </Text>
          {locationError && <Text style={styles.errorText}>{locationError}</Text>}
        </View>
        {locatingBusy ? (
          <ActivityIndicator color={C.ink} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={C.mist} />
        )}
      </Pressable>
      <Pressable style={styles.settings} onPress={() => navigation.navigate("Privacy")}>
        <Text style={styles.settingsText}>Daten & DSGVO</Text>
        <Ionicons name="chevron-forward" size={18} color={C.mist} />
      </Pressable>
      <Pressable style={styles.settings} onPress={logout}>
        <Text style={[styles.settingsText, { color: C.ember }]}>Abmelden</Text>
        <Ionicons name="chevron-forward" size={18} color={C.mist} />
      </Pressable>
    </ScrollView>
  );
}
