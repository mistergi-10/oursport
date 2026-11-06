import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Chip } from "../components/Chip";
import { Header } from "../components/Header";
import { AuthActionsContext, AuthContext, ProfileContext } from "../context/AppContext";
import { apiRequest, describeApiError } from "../lib/api";
import { localeDisplayNames, setLocale, supportedLocales, translateSport } from "../lib/i18n";
import { disablePushNotifications, enablePushNotifications, getExistingPushSubscription, isPushSupported } from "../lib/push";
import type { Profile, RatingSummary } from "../lib/types";
import { useTheme } from "../theme";
import { COURT_FIXED, spacing } from "../theme/tokens";
import type { RootStackParamList } from "../navigation/types";

export function ProfileScreen() {
  const { palette: C, styles, scheme, toggleScheme } = useTheme();
  const { t, i18n } = useTranslation();
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
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);

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

  useEffect(() => {
    let active = true;
    apiRequest<{ summary: RatingSummary }>("/v1/users/me/ratings", auth)
      .then((response) => {
        if (active) setRatingSummary(response.summary);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [auth.token, auth.userId]);

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
      setNotificationsError(describeApiError(error, t("profile.notificationsChangeFailed")));
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
      setPhotoError(t("profile.photoAccessDenied"));
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
      setPhotoError(t("profile.photoTooLarge"));
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
      setPhotoError(t("profile.photoSaveFailed"));
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
        setLocationError(t("profile.locationAccessDenied"));
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
      setLocationError(t("profile.locationFailed"));
    } finally {
      setLocatingBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title={t("profile.title")} accentColor="mist" />
      <View style={styles.profileHead}>
        <Pressable
          onPress={() => void pickPhoto()}
          disabled={uploadingPhoto}
          accessibilityRole="button"
          accessibilityLabel={t("profile.changePhoto")}
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
          {profile.city} · {translateSport(profile.sport)}
        </Text>
        {photoError && <Text style={styles.errorText}>{photoError}</Text>}
      </View>
      <Text style={styles.label}>{t("profile.appearance")}</Text>
      <View style={styles.settings}>
        <Text style={styles.settingsText}>{t("profile.darkMode")}</Text>
        <Switch
          value={scheme === "dark"}
          onValueChange={toggleScheme}
          trackColor={{ true: C.volt, false: C.line }}
          thumbColor={COURT_FIXED}
        />
      </View>
      <Text style={styles.label}>{t("profile.language")}</Text>
      <View style={[styles.settings, { flexWrap: "wrap", gap: spacing.sm }]}>
        {supportedLocales.map((locale) => (
          <Chip
            key={locale}
            label={localeDisplayNames[locale]}
            selected={i18n.language === locale}
            onPress={() => void setLocale(locale)}
          />
        ))}
      </View>
      <Text style={styles.label}>{t("profile.notifications")}</Text>
      <View style={styles.settings}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.settingsText}>{t("profile.pushTitle")}</Text>
          <Text style={styles.helper}>
            {pushSupported
              ? t("profile.pushSupportedBody")
              : t("profile.pushUnsupportedBody")}
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
      <Text style={styles.label}>{t("profile.ratingsLabel")}</Text>
      <View style={styles.settings}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.settingsText}>
            {ratingSummary && ratingSummary.ratingCount > 0
              ? `${ratingSummary.averageRating?.toFixed(1)} \u2605 (${ratingSummary.ratingCount})`
              : t("profile.noRatingsYet")}
          </Text>
          <Text style={styles.helper}>{t("profile.ratingsHelper")}</Text>
        </View>
      </View>
      <Text style={styles.label}>{t("profile.account")}</Text>
      {[
        t("profile.personalInfo"),
        t("profile.sportsLevel"),
        t("profile.availability"),
      ].map((item) => (
        <Pressable
          style={styles.settings}
          key={item}
          onPress={() => Alert.alert(t("profile.comingSoonTitle"), t("profile.comingSoonBody", { item }))}
        >
          <Text style={styles.settingsText}>{item}</Text>
          <Ionicons name="chevron-forward" size={18} color={C.mist} />
        </Pressable>
      ))}
      <Pressable style={styles.settings} onPress={() => void useCurrentLocation()} disabled={locatingBusy}>
        <View style={{ flex: 1, marginRight: spacing.md }}>
          <Text style={styles.settingsText}>{t("profile.useLocation")}</Text>
          <Text style={styles.helper}>
            {profile.latitude != null && profile.longitude != null
              ? t("profile.locationSavedBody")
              : t("profile.locationPromptBody")}
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
        <Text style={styles.settingsText}>{t("profile.privacyRow")}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.mist} />
      </Pressable>
      <Pressable style={styles.settings} onPress={logout}>
        <Text style={[styles.settingsText, { color: C.ember }]}>{t("profile.logout")}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.mist} />
      </Pressable>
    </ScrollView>
  );
}
