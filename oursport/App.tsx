import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { createContext, useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const C = {
  ink: "#12181A",
  cloud: "#F3F5EF",
  court: "#FFFFFF",
  volt: "#C6F24C",
  ember: "#FF5C39",
  mist: "#778078",
  line: "#E1E6DD",
};
type Profile = { name: string; city: string; sport: string; level: string };
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:10000";

type RootStackParamList = {
  Welcome: undefined;
  Login: undefined;
  Signup: undefined;
  Main: { screen?: keyof MainTabParamList } | undefined;
};
type MainTabParamList = {
  Matching: undefined;
  Chats: undefined;
  Events: undefined;
  Profile: undefined;
};
const RootStack = createNativeStackNavigator<RootStackParamList>();
const MainTab = createBottomTabNavigator<MainTabParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();
const ProfileContext = createContext<Profile | null>(null);
const AuthActionsContext = createContext<{ logout: () => void }>({
  logout: () => undefined,
});
const tabIcons: Record<keyof MainTabParamList, string> = {
  Matching: "♡",
  Chats: "◌",
  Events: "□",
  Profile: "○",
};
const tabLabels: Record<keyof MainTabParamList, string> = {
  Matching: "Matching",
  Chats: "Chats",
  Events: "Events",
  Profile: "Profil",
};
const sports = [
  "Laufen",
  "Tennis",
  "Klettern",
  "Yoga",
  "Fussball",
  "Radfahren",
];
const levels = ["Anfaenger", "Fortgeschritten", "Profi"];

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    async function bootstrap() {
      const [storedProfile, storedUserId, storedToken] = await Promise.all([
        AsyncStorage.getItem("oursport-profile"),
        AsyncStorage.getItem("oursport-user-id"),
        AsyncStorage.getItem("oursport-token"),
      ]);
      const nextUserId = storedUserId ?? createUserId();
      if (!storedUserId) await AsyncStorage.setItem("oursport-user-id", nextUserId);
      setUserId(nextUserId);
      setToken(storedToken);
      if (storedProfile) setProfile(JSON.parse(storedProfile));
      try {
        const auth = storedToken ? { token: storedToken } : { userId: nextUserId };
        const remoteProfile = await apiRequest<Profile>("/v1/me", auth);
        setProfile(remoteProfile);
        await AsyncStorage.setItem("oursport-profile", JSON.stringify(remoteProfile));
      } catch {
        if (storedToken) {
          await AsyncStorage.multiRemove(["oursport-token", "oursport-profile"]);
          setToken(null);
          setProfile(null);
        }
      }
      setLoading(false);
    }
    void bootstrap();
  }, []);

  const handleAuthenticated = async (nextToken: string, nextProfile: Profile) => {
    await AsyncStorage.multiSet([
      ["oursport-token", nextToken],
      ["oursport-profile", JSON.stringify(nextProfile)],
    ]);
    setToken(nextToken);
    setProfile(nextProfile);
  };

  const authActions = {
    logout: () => {
      void AsyncStorage.multiRemove(["oursport-token", "oursport-profile"]);
      setToken(null);
      setProfile(null);
      navigationRef.current?.reset({ index: 0, routes: [{ name: "Welcome" }] });
    },
  };

  if (loading)
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.ink} />
      </View>
    );
  return (
    <ProfileContext.Provider value={profile}>
      <AuthActionsContext.Provider value={authActions}>
        <NavigationContainer ref={navigationRef}>
          <RootStack.Navigator
            screenOptions={{ headerShown: false }}
            initialRouteName={profile ? "Main" : "Welcome"}
          >
            <RootStack.Screen name="Welcome">
              {({ navigation }) => (
                <WelcomeScreen
                  onCreateAccount={() => navigation.navigate("Signup")}
                  onLogin={() => navigation.navigate("Login")}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="Login">
              {({ navigation }) => (
                <LoginScreen
                  onSwitchToSignup={() => navigation.navigate("Signup")}
                  onAuthenticated={async (nextToken, nextProfile) => {
                    await handleAuthenticated(nextToken, nextProfile);
                    navigation.reset({ index: 0, routes: [{ name: "Main" }] });
                  }}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="Signup">
              {({ navigation }) => (
                <SignupScreen
                  onSwitchToLogin={() => navigation.navigate("Login")}
                  onAuthenticated={async (nextToken, nextProfile) => {
                    await handleAuthenticated(nextToken, nextProfile);
                    navigation.reset({ index: 0, routes: [{ name: "Main" }] });
                  }}
                />
              )}
            </RootStack.Screen>
            <RootStack.Screen name="Main" component={MainTabs} />
          </RootStack.Navigator>
        </NavigationContainer>
      </AuthActionsContext.Provider>
    </ProfileContext.Provider>
  );
}

function WelcomeScreen({
  onCreateAccount,
  onLogin,
}: {
  onCreateAccount: () => void;
  onLogin: () => void;
}) {
  const features: [string, string][] = [
    ["♥", "Finde Trainingspartner, die zu deinem Level passen"],
    ["◌", "Chatte direkt und plant euer naechstes Training"],
    ["□", "Entdecke lokale Sport-Events in deiner Naehe"],
  ];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.welcome}>
        <View style={styles.hero}>
          <BrandMark />
          <Text style={styles.wordmark}>Our Sport</Text>
          <Text style={styles.tagline}>
            Finde Trainingspartner in deiner Naehe. Sport macht zu zweit
            einfach mehr Spass.
          </Text>
        </View>
        <View style={styles.features}>
          {features.map(([icon, text]) => (
            <View style={styles.feature} key={text}>
              <View style={styles.featureIcon}>
                <Text style={styles.tabIcon}>{icon}</Text>
              </View>
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
        </View>
        <Pressable style={styles.primary} onPress={onCreateAccount}>
          <Text style={styles.primaryText}>Konto erstellen</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onLogin}>
          <Text style={styles.secondaryText}>Ich habe schon ein Konto</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function SocialAuthButtons() {
  const notify = () =>
    Alert.alert("Bald verfuegbar", "Login mit Google und Apple folgt in Kuerze.");
  return (
    <View style={styles.socialRow}>
      <Pressable style={styles.socialButton} onPress={notify}>
        <Text style={styles.socialButtonText}>Mit Google fortfahren</Text>
      </Pressable>
      <Pressable style={styles.socialButton} onPress={notify}>
        <Text style={styles.socialButtonText}>Mit Apple fortfahren</Text>
      </Pressable>
    </View>
  );
}

function createUserId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

type Auth = { token?: string; userId?: string };

async function apiRequest<T>(path: string, auth: Auth, options?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}),
      ...(auth.userId ? { "x-user-id": auth.userId } : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) throw new Error(`API request failed: ${response.status}`);
  return (await response.json()) as T;
}

async function authRequest<T>(path: string, body: unknown) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (payload as { error?: string } | null)?.error;
    throw new Error(message ?? "Anfrage fehlgeschlagen");
  }
  return payload as T;
}

function BrandMark() {
  return (
    <View style={styles.brandMark}>
      <Text style={styles.brandSymbol}>O</Text>
      <View style={styles.brandDot}>
        <Text>+</Text>
      </View>
    </View>
  );
}

function SignupScreen({
  onAuthenticated,
  onSwitchToLogin,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToLogin: () => void;
}) {
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
              style={[styles.level, level === item && styles.levelSelected]}
              onPress={() => setLevel(item)}
            >
              <Text style={level === item ? styles.selected : styles.chipText}>
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.primary} onPress={save} disabled={submitting}>
          <Text style={styles.primaryText}>
            {submitting ? "Wird erstellt..." : "Konto erstellen"}
          </Text>
        </Pressable>
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToLogin}>
          <Text style={styles.switchLink}>Ich habe schon ein Konto</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoginScreen({
  onAuthenticated,
  onSwitchToSignup,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToSignup: () => void;
}) {
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
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.primary} onPress={login} disabled={submitting}>
          <Text style={styles.primaryText}>
            {submitting ? "Wird geprueft..." : "Anmelden"}
          </Text>
        </Pressable>
        <SocialAuthButtons />
        <Pressable onPress={onSwitchToSignup}>
          <Text style={styles.switchLink}>Neues Konto erstellen</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
    >
      <Text style={selected ? styles.selected : styles.chipText}>{label}</Text>
    </Pressable>
  );
}

function MainTabs({ navigation }: NativeStackScreenProps<RootStackParamList, "Main">) {
  const [match, setMatch] = useState(false);
  const [passed, setPassed] = useState(false);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.flex}>
        <MainTab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: styles.tabBar,
            tabBarItemStyle: styles.tabItem,
            tabBarActiveTintColor: C.ink,
            tabBarInactiveTintColor: C.mist,
            tabBarLabel: ({ color }) => (
              <Text style={[styles.tabLabel, { color }]}>
                {tabLabels[route.name]}
              </Text>
            ),
            tabBarIcon: ({ color }) => (
              <Text style={[styles.tabIcon, { color }]}>
                {tabIcons[route.name]}
              </Text>
            ),
          })}
        >
          <MainTab.Screen name="Matching">
            {() => (
              <Matching
                passed={passed}
                onPass={() => setPassed(true)}
                onLike={() => setMatch(true)}
              />
            )}
          </MainTab.Screen>
          <MainTab.Screen name="Chats" component={Chats} />
          <MainTab.Screen name="Events" component={Events} />
          <MainTab.Screen name="Profile" component={ProfileScreen} />
        </MainTab.Navigator>
        {match && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <Text style={styles.overlayHeart}>♥</Text>
              <Text style={styles.overlayTitle}>Es ist ein Match!</Text>
              <Text style={styles.overlayBody}>
                Du und Lena wollt beide Laufen gehen. Schreib ihr und findet
                euren naechsten Termin.
              </Text>
              <Pressable
                style={styles.primary}
                onPress={() => {
                  setMatch(false);
                  navigation.navigate("Main", { screen: "Chats" });
                }}
              >
                <Text style={styles.primaryText}>Nachricht schreiben</Text>
              </Pressable>
              <Pressable onPress={() => setMatch(false)}>
                <Text style={styles.dismiss}>Weiter matchen</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable style={styles.filter}>
        <Text>☷</Text>
      </Pressable>
    </View>
  );
}
function Matching({
  passed,
  onPass,
  onLike,
}: {
  passed: boolean;
  onPass: () => void;
  onLike: () => void;
}) {
  const profile = useContext(ProfileContext);
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <Header title="Matching" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {sports.slice(0, 4).map((item) => (
          <Chip
            key={item}
            label={item}
            selected={item === profile?.sport}
            onPress={() => undefined}
          />
        ))}
      </ScrollView>
      {passed ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Das war's fuers Erste</Text>
          <Text style={styles.helper}>
            Schau spaeter wieder vorbei, dann warten neue Trainingspartner auf
            dich.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.matchCard}>
            <View style={styles.photo}>
              <Text style={styles.photoEmoji}>🏃</Text>
              <Text style={styles.distance}>● 2,3 km</Text>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardName}>Lena, 27</Text>
              <Text style={styles.cardMeta}>Laufen · Fortgeschritten</Text>
              <View style={styles.tags}>
                <Text style={styles.tag}>Mo · Mi · Sa</Text>
                <Text style={styles.tag}>Abends</Text>
              </View>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable style={styles.pass} onPress={onPass}>
              <Text style={styles.actionText}>×</Text>
            </Pressable>
            <Pressable style={styles.like} onPress={onLike}>
              <Text style={styles.likeText}>♥</Text>
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}
function Chats() {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Chats" />
      {[
        ["Lena", "Super, dann bis morgen um 18 Uhr!", "14:02", C.ember],
        ["Jonas", "Klingt gut, welcher Park passt dir?", "Gestern", "#69B7EA"],
        [
          "Klettergruppe Basel",
          "Mia: Ich bring extra Chalk mit",
          "Mo",
          "#A98BEE",
        ],
      ].map(([name, preview, time, color]) => (
        <View style={styles.chatRow} key={String(name)}>
          <View style={[styles.avatar, { backgroundColor: color as string }]}>
            <Text style={styles.avatarLetter}>{String(name)[0]}</Text>
          </View>
          <View style={styles.chatInfo}>
            <Text style={styles.chatName}>{name}</Text>
            <Text style={styles.chatPreview}>{preview}</Text>
          </View>
          <Text style={styles.chatTime}>{time}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
function Events() {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Events" />
      {[
        [
          "05",
          "Sep",
          "Wer will morgen joggen?",
          "18:00 · Rheinufer Kleinbasel",
        ],
        [
          "07",
          "Sep",
          "Klettertreff Kunstwand Basel",
          "10:00 · Boulderhalle Nord",
        ],
        ["09", "Sep", "Sonntags-Yoga im Park", "09:00 · St. Johanns-Park"],
      ].map(([day, month, title, meta]) => (
        <View style={styles.event} key={title}>
          <View style={styles.eventTop}>
            <View style={styles.date}>
              <Text style={styles.dateNumber}>{day}</Text>
              <Text style={styles.dateMonth}>{month}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.eventTitle}>{title}</Text>
              <Text style={styles.eventMeta}>{meta}</Text>
            </View>
          </View>
          <View style={styles.eventFooter}>
            <Text style={styles.helper}>● ● +3</Text>
            <Pressable style={styles.join}>
              <Text style={styles.joinText}>Beitreten</Text>
            </Pressable>
          </View>
        </View>
      ))}
      <Pressable style={styles.fab}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </ScrollView>
  );
}
function ProfileScreen() {
  const profile = useContext(ProfileContext);
  const { logout } = useContext(AuthActionsContext);
  if (!profile) return null;
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Profil" />
      <View style={styles.profileHead}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileInitial}>
            {profile.name[0]?.toUpperCase()}
          </Text>
        </View>
        <Text style={styles.profileName}>{profile.name}, 29</Text>
        <Text style={styles.profileSub}>
          {profile.city} · {profile.sport}
        </Text>
        <Text style={styles.verified}>✓ Telefonnummer verifiziert</Text>
      </View>
      <View style={styles.stats}>
        {[
          ["18", "Trainings"],
          ["4.9", "Bewertung"],
          ["6", "Matches"],
        ].map(([value, label]) => (
          <View style={styles.stat} key={label}>
            <Text style={styles.statValue}>{value}</Text>
            <Text style={styles.statLabel}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.label}>Konto</Text>
      {[
        "Persoenliche Angaben",
        "Sportarten & Level",
        "Verfuegbarkeit",
        "Standortdienste",
        "Daten & DSGVO",
      ].map((item) => (
        <View style={styles.settings} key={item}>
          <Text style={styles.settingsText}>{item}</Text>
          <Text style={styles.arrow}>›</Text>
        </View>
      ))}
      <Pressable style={styles.settings} onPress={logout}>
        <Text style={[styles.settingsText, { color: C.ember }]}>Abmelden</Text>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.cloud },
  flex: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.cloud,
  },
  setup: { flexGrow: 1, padding: 24, paddingBottom: 34 },
  welcome: { flex: 1, padding: 28, paddingBottom: 40, justifyContent: "space-between" },
  features: { gap: 18, marginTop: 12 },
  feature: { flexDirection: "row", alignItems: "center", gap: 14 },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { color: C.ink, fontSize: 14, fontWeight: "600", flex: 1 },
  hero: { alignItems: "center", paddingVertical: 24 },
  brandMark: {
    width: 122,
    height: 122,
    borderRadius: 34,
    backgroundColor: C.volt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 22,
  },
  brandSymbol: { fontSize: 70, fontWeight: "800", color: C.ink },
  brandDot: {
    position: "absolute",
    right: -10,
    top: -10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.ember,
    alignItems: "center",
    justifyContent: "center",
  },
  wordmark: { color: C.ink, fontSize: 40, fontWeight: "800" },
  tagline: {
    color: C.mist,
    textAlign: "center",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    maxWidth: 310,
  },
  title: { color: C.ink, fontSize: 25, fontWeight: "800", marginTop: 10 },
  helper: { color: C.mist, fontSize: 13, lineHeight: 19 },
  label: {
    color: C.mist,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 22,
    marginBottom: 9,
  },
  input: {
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 15,
    height: 52,
    paddingHorizontal: 16,
    color: C.ink,
    fontSize: 15,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: {
    backgroundColor: C.court,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipSelected: { backgroundColor: C.ink, borderColor: C.ink },
  chipText: { color: C.ink, fontSize: 13, fontWeight: "600" },
  selected: { color: C.volt, fontSize: 13, fontWeight: "700" },
  levels: { flexDirection: "row", gap: 8 },
  level: {
    flex: 1,
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 13,
  },
  levelSelected: { backgroundColor: C.volt, borderColor: C.volt },
  primary: {
    backgroundColor: C.ink,
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 28,
  },
  primaryText: { color: C.volt, fontSize: 15, fontWeight: "800" },
  secondary: {
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.line,
  },
  secondaryText: { color: C.ink, fontSize: 15, fontWeight: "800" },
  socialRow: { gap: 10, marginTop: 14 },
  socialButton: {
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 15,
  },
  socialButtonText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  switchLink: {
    color: C.mist,
    textAlign: "center",
    marginTop: 20,
    fontWeight: "700",
  },
  errorText: { color: C.ember, fontSize: 13, marginTop: 16, fontWeight: "600" },
  screen: { flexGrow: 1, padding: 22, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 17,
  },
  headerTitle: { color: C.ink, fontSize: 25, fontWeight: "800" },
  filter: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: { gap: 8, paddingBottom: 16 },
  matchCard: {
    backgroundColor: C.court,
    borderRadius: 27,
    overflow: "hidden",
    elevation: 5,
  },
  photo: {
    height: 265,
    backgroundColor: "#FFC178",
    alignItems: "center",
    justifyContent: "center",
  },
  photoEmoji: { fontSize: 90 },
  distance: {
    position: "absolute",
    top: 16,
    left: 16,
    backgroundColor: C.court,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    color: C.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  cardBody: { padding: 18 },
  cardName: { color: C.ink, fontSize: 21, fontWeight: "800" },
  cardMeta: { color: C.mist, marginTop: 5 },
  tags: { flexDirection: "row", gap: 7, marginTop: 13 },
  tag: {
    backgroundColor: C.cloud,
    color: C.ink,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    fontSize: 12,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    marginTop: 22,
  },
  pass: {
    width: 58,
    height: 58,
    borderRadius: 30,
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  like: {
    width: 58,
    height: 58,
    borderRadius: 30,
    backgroundColor: C.ember,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontSize: 32, color: C.ink },
  likeText: { fontSize: 24, color: C.court },
  empty: { alignItems: "center", paddingTop: 130, paddingHorizontal: 25 },
  emptyTitle: {
    color: C.ink,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 7,
  },
  tabBar: {
    height: 76,
    backgroundColor: C.court,
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 10,
  },
  tabItem: { alignItems: "center", width: 70 },
  tabIcon: { color: C.mist, fontSize: 25, lineHeight: 28 },
  tabLabel: { color: C.mist, fontSize: 11, fontWeight: "700", marginTop: 2 },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { color: C.court, fontSize: 20, fontWeight: "800" },
  chatInfo: { flex: 1 },
  chatName: { color: C.ink, fontSize: 15, fontWeight: "800" },
  chatPreview: { color: C.mist, fontSize: 13, marginTop: 4 },
  chatTime: { color: C.mist, fontSize: 11 },
  event: {
    backgroundColor: C.court,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    padding: 17,
    marginBottom: 13,
  },
  eventTop: { flexDirection: "row", gap: 14 },
  date: {
    width: 53,
    height: 53,
    borderRadius: 14,
    backgroundColor: C.cloud,
    alignItems: "center",
    justifyContent: "center",
  },
  dateNumber: { color: C.ink, fontSize: 18, fontWeight: "800" },
  dateMonth: { color: C.mist, fontSize: 10, fontWeight: "800" },
  eventTitle: {
    color: C.ink,
    fontSize: 15,
    fontWeight: "800",
    marginBottom: 4,
  },
  eventMeta: { color: C.mist, fontSize: 12 },
  eventFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 15,
  },
  join: {
    backgroundColor: C.ink,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 9,
  },
  joinText: { color: C.volt, fontSize: 12, fontWeight: "800" },
  fab: {
    position: "absolute",
    right: 22,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: C.volt,
    alignItems: "center",
    justifyContent: "center",
  },
  fabText: { color: C.ink, fontSize: 30 },
  profileHead: { alignItems: "center", paddingVertical: 8 },
  profileAvatar: {
    width: 96,
    height: 96,
    borderRadius: 31,
    backgroundColor: C.volt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },
  profileInitial: { color: C.ink, fontSize: 38, fontWeight: "800" },
  profileName: { color: C.ink, fontSize: 21, fontWeight: "800" },
  profileSub: { color: C.mist, fontSize: 13, marginTop: 3 },
  verified: {
    color: C.ink,
    backgroundColor: C.court,
    borderRadius: 15,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 10,
    fontSize: 12,
    fontWeight: "700",
  },
  stats: { flexDirection: "row", gap: 9, marginVertical: 21 },
  stat: {
    flex: 1,
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 15,
    paddingVertical: 14,
    alignItems: "center",
  },
  statValue: { color: C.ink, fontSize: 19, fontWeight: "800" },
  statLabel: { color: C.mist, fontSize: 11, marginTop: 3 },
  settings: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  settingsText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  arrow: { color: C.mist, fontSize: 22 },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(18,24,26,0.88)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  overlayCard: {
    backgroundColor: C.ink,
    borderRadius: 25,
    padding: 26,
    width: "100%",
    alignItems: "center",
  },
  overlayHeart: { color: C.volt, fontSize: 48 },
  overlayTitle: {
    color: C.volt,
    fontSize: 28,
    fontWeight: "800",
    marginTop: 12,
  },
  overlayBody: {
    color: "#CBD2C7",
    textAlign: "center",
    lineHeight: 21,
    marginTop: 10,
  },
  dismiss: { color: "#CBD2C7", paddingVertical: 16, fontWeight: "700" },
});
