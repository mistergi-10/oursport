import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NavigationContainer,
  createNavigationContainerRef,
  useFocusEffect,
  useNavigation,
} from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar } from "expo-status-bar";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
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
type Profile = { userId: string; name: string; city: string; sport: string; level: string };
type Candidate = {
  userId: string;
  name: string;
  city: string;
  sport: string;
  level: string;
  bio: string | null;
};
type LastMessage = { body: string; senderUserId: string; createdAt: string };
type ConversationSummary = {
  conversationId: string;
  matchId: string;
  userId: string;
  name: string;
  city: string;
  sport: string;
  lastMessage: LastMessage | null;
  updatedAt: string;
};
type ConversationMessage = {
  messageId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
};
type MatchInfo = { userId: string; name: string; city: string; sport: string };
type BlockedUser = { userId: string; name: string };
type ReportReason = "spam" | "harassment" | "fake_profile" | "inappropriate_content" | "other";
type EventSummary = {
  eventId: string;
  title: string;
  sport: string;
  city: string;
  startsAt: string;
  description: string | null;
  capacity: number;
  attendeeCount: number;
  spotsLeft: number;
  isAttending: boolean;
  isCreator: boolean;
  creatorUserId: string;
  creatorName: string;
};
type EventAttendee = { userId: string; name: string };
type EventDetail = EventSummary & { attendees: EventAttendee[] };
type Auth = { token?: string; userId?: string };
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:10000";

type RootStackParamList = {
  Welcome: undefined;
  Login: { successMessage?: string } | undefined;
  Signup: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string; devCode?: string };
  Main: { screen?: keyof MainTabParamList } | undefined;
  Conversation: { conversationId: string; name: string; userId: string };
  CreateEvent: undefined;
  EventDetail: { eventId: string };
  Privacy: undefined;
  Report: { userId: string; name: string };
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
const AuthContext = createContext<Auth>({});
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
  const auth: Auth = token ? { token } : userId ? { userId } : {};
  return (
    <ProfileContext.Provider value={profile}>
      <AuthActionsContext.Provider value={authActions}>
        <AuthContext.Provider value={auth}>
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
                {({ navigation, route }) => (
                  <LoginScreen
                    successMessage={route.params?.successMessage}
                    onSwitchToSignup={() => navigation.navigate("Signup")}
                    onForgotPassword={() => navigation.navigate("ForgotPassword")}
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
              <RootStack.Screen name="ForgotPassword">
                {({ navigation }) => (
                  <ForgotPasswordScreen
                    onCodeRequested={(email, devCode) =>
                      navigation.navigate("ResetPassword", { email, devCode })
                    }
                    onBackToLogin={() => navigation.navigate("Login")}
                  />
                )}
              </RootStack.Screen>
              <RootStack.Screen name="ResetPassword">
                {({ navigation, route }) => (
                  <ResetPasswordScreen
                    email={route.params.email}
                    devCode={route.params.devCode}
                    onSuccess={() =>
                      navigation.reset({
                        index: 0,
                        routes: [
                          {
                            name: "Login",
                            params: { successMessage: "Passwort erfolgreich geaendert. Bitte anmelden." },
                          },
                        ],
                      })
                    }
                  />
                )}
              </RootStack.Screen>
              <RootStack.Screen name="Main" component={MainTabs} />
              <RootStack.Screen name="Conversation" component={ConversationScreen} />
              <RootStack.Screen name="CreateEvent" component={CreateEventScreen} />
              <RootStack.Screen name="EventDetail" component={EventDetailScreen} />
              <RootStack.Screen name="Privacy" component={PrivacyScreen} />
              <RootStack.Screen name="Report" component={ReportScreen} />
            </RootStack.Navigator>
          </NavigationContainer>
        </AuthContext.Provider>
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

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = (payload as { error?: string } | null)?.error;
    throw new ApiError(response.status, message ?? `API request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

// Shared message for the newly rate-limited mutation routes (swipe, send message,
// create/join/leave event, block, report, delete account).
function describeApiError(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && caught.status === 429) return "Zu viele Anfragen, bitte kurz warten.";
  return fallback;
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
  onForgotPassword,
  successMessage,
}: {
  onAuthenticated: (token: string, profile: Profile) => void | Promise<void>;
  onSwitchToSignup: () => void;
  onForgotPassword: () => void;
  successMessage?: string;
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
        {successMessage && <Text style={styles.helper}>{successMessage}</Text>}
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
        <Pressable onPress={onForgotPassword}>
          <Text style={styles.switchLink}>Passwort vergessen?</Text>
        </Pressable>
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

function ForgotPasswordScreen({
  onCodeRequested,
  onBackToLogin,
}: {
  onCodeRequested: (email: string, devCode?: string) => void;
  onBackToLogin: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | undefined>(undefined);

  const requestCode = async () => {
    if (!email.trim()) {
      setError("Bitte eine E-Mail-Adresse angeben.");
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
      setError(caught instanceof Error ? caught.message : "Anfrage fehlgeschlagen");
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
          <Text style={styles.tagline}>Passwort zuruecksetzen</Text>
        </View>
        <Text style={styles.title}>Passwort vergessen?</Text>
        <Text style={styles.helper}>
          Gib deine E-Mail ein, wir schicken dir einen Code zum Zuruecksetzen.
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
          editable={!sent}
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        {sent ? (
          <>
            <Text style={styles.helper}>
              Falls die E-Mail existiert, haben wir dir einen Code geschickt.
              Pruefe dein Postfach.
            </Text>
            <Pressable
              style={styles.primary}
              onPress={() => onCodeRequested(email.trim(), devCode)}
            >
              <Text style={styles.primaryText}>Code eingeben</Text>
            </Pressable>
          </>
        ) : (
          <Pressable style={styles.primary} onPress={requestCode} disabled={submitting}>
            <Text style={styles.primaryText}>
              {submitting ? "Wird gesendet..." : "Code senden"}
            </Text>
          </Pressable>
        )}
        <Pressable onPress={onBackToLogin}>
          <Text style={styles.switchLink}>Zurueck zur Anmeldung</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ResetPasswordScreen({
  email,
  devCode,
  onSuccess,
}: {
  email: string;
  devCode?: string;
  onSuccess: () => void;
}) {
  const [emailValue, setEmailValue] = useState(email);
  const [code, setCode] = useState(devCode ?? "");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const confirm = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError("Bitte den 6-stelligen Code eingeben.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Das neue Passwort braucht mind. 8 Zeichen.");
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
      setError(caught instanceof Error ? caught.message : "Zuruecksetzen fehlgeschlagen");
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
          <Text style={styles.tagline}>Neues Passwort festlegen</Text>
        </View>
        <Text style={styles.title}>Code eingeben</Text>
        <Text style={styles.label}>E-Mail</Text>
        <TextInput
          value={emailValue}
          onChangeText={setEmailValue}
          placeholder="du@beispiel.ch"
          placeholderTextColor={C.mist}
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Text style={styles.label}>Code</Text>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="6-stelliger Code"
          placeholderTextColor={C.mist}
          style={styles.input}
          keyboardType="number-pad"
          maxLength={6}
        />
        <Text style={styles.label}>Neues Passwort</Text>
        <TextInput
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="Mind. 8 Zeichen"
          placeholderTextColor={C.mist}
          style={styles.input}
          secureTextEntry
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.primary} onPress={confirm} disabled={submitting}>
          <Text style={styles.primaryText}>
            {submitting ? "Wird gespeichert..." : "Passwort speichern"}
          </Text>
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

function Checkbox({
  checked,
  onPress,
  label,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
}) {
  return (
    <Pressable style={styles.checkboxRow} onPress={onPress}>
      <View style={[styles.checkboxBox, checked && styles.checkboxBoxChecked]}>
        {checked && <Text style={styles.checkboxMark}>✓</Text>}
      </View>
      <Text style={styles.checkboxLabel}>{label}</Text>
    </Pressable>
  );
}

function MainTabs({ navigation }: NativeStackScreenProps<RootStackParamList, "Main">) {
  const [activeMatch, setActiveMatch] = useState<MatchInfo | null>(null);
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
            {() => <Matching onMatch={setActiveMatch} />}
          </MainTab.Screen>
          <MainTab.Screen name="Chats" component={MatchesList} />
          <MainTab.Screen name="Events" component={Events} />
          <MainTab.Screen name="Profile" component={ProfileScreen} />
        </MainTab.Navigator>
        {activeMatch && (
          <View style={styles.overlay}>
            <View style={styles.overlayCard}>
              <Text style={styles.overlayHeart}>♥</Text>
              <Text style={styles.overlayTitle}>Es ist ein Match!</Text>
              <Text style={styles.overlayBody}>
                Du und {activeMatch.name} wollt beide {activeMatch.sport} gehen.
                Schaut, wann es bei euch beiden passt.
              </Text>
              <Pressable
                style={styles.primary}
                onPress={() => {
                  setActiveMatch(null);
                  navigation.navigate("Main", { screen: "Chats" });
                }}
              >
                <Text style={styles.primaryText}>Match ansehen</Text>
              </Pressable>
              <Pressable onPress={() => setActiveMatch(null)}>
                <Text style={styles.dismiss}>Weiter matchen</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Header({
  title,
  actionIcon = "☷",
  onAction,
}: {
  title: string;
  actionIcon?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>{title}</Text>
      <Pressable style={styles.filter} onPress={onAction}>
        <Text>{actionIcon}</Text>
      </Pressable>
    </View>
  );
}
function Matching({ onMatch }: { onMatch: (match: MatchInfo) => void }) {
  const profile = useContext(ProfileContext);
  const auth = useContext(AuthContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [queue, setQueue] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [swipeError, setSwipeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadCandidates = useCallback(
    async (afterCursor: string | null) => {
      setLoading(true);
      setLoadError(false);
      try {
        const query = afterCursor ? `?cursor=${encodeURIComponent(afterCursor)}` : "";
        const response = await apiRequest<{ candidates: Candidate[]; nextCursor: string | null }>(
          `/v1/discover${query}`,
          auth,
        );
        setQueue((current) => [...current, ...response.candidates]);
        setCursor(response.nextCursor);
        if (response.nextCursor === null) setExhausted(true);
      } catch {
        // distinct from "exhausted" so the UI can offer a retry instead of
        // implying there simply are no more candidates
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    },
    [auth.token, auth.userId],
  );

  useFocusEffect(
    useCallback(() => {
      setQueue([]);
      setCursor(null);
      setExhausted(false);
      setLoadError(false);
      setSwipeError(null);
      void loadCandidates(null);
    }, [loadCandidates]),
  );

  const current = queue[0];

  useEffect(() => {
    if (!current && !loading && !exhausted && !loadError && cursor) void loadCandidates(cursor);
  }, [current, loading, exhausted, loadError, cursor, loadCandidates]);

  const swipe = async (action: "like" | "pass") => {
    if (!current || submitting) return;
    const candidate = current;
    setSubmitting(true);
    setQueue((rest) => rest.slice(1));
    setSwipeError(null);
    try {
      const response = await apiRequest<
        { matched: false } | { matched: true; match: MatchInfo }
      >("/v1/swipes", auth, {
        method: "POST",
        body: JSON.stringify({ targetUserId: candidate.userId, action }),
      });
      if (response.matched) onMatch(response.match);
    } catch (caught) {
      // requeue the candidate so the user can retry instead of silently losing the swipe
      setQueue((rest) => [candidate, ...rest]);
      setSwipeError(describeApiError(caught, "Verbindungsfehler, bitte erneut versuchen"));
    } finally {
      setSubmitting(false);
    }
  };

  const blockCandidate = async (candidate: Candidate) => {
    setSwipeError(null);
    setQueue((rest) => rest.filter((item) => item.userId !== candidate.userId));
    try {
      await apiRequest("/v1/blocks", auth, {
        method: "POST",
        body: JSON.stringify({ userId: candidate.userId }),
      });
    } catch (caught) {
      setQueue((rest) => [candidate, ...rest]);
      setSwipeError(describeApiError(caught, "Blockieren fehlgeschlagen, bitte erneut versuchen"));
    }
  };

  const confirmBlockCandidate = (candidate: Candidate) => {
    Alert.alert(`${candidate.name} blockieren?`, "Ihr seht euch danach nicht mehr beim Matching.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => void blockCandidate(candidate) },
    ]);
  };

  const openCardMenu = (candidate: Candidate) => {
    Alert.alert(candidate.name, undefined, [
      {
        text: "Melden",
        onPress: () => navigation.navigate("Report", { userId: candidate.userId, name: candidate.name }),
      },
      { text: "Blockieren", style: "destructive", onPress: () => confirmBlockCandidate(candidate) },
      { text: "Abbrechen", style: "cancel" },
    ]);
  };

  const noMoreCandidates = !current && exhausted;
  const failedToLoad = !current && loadError && !exhausted;

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
      {noMoreCandidates ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Das war's fuers Erste</Text>
          <Text style={styles.helper}>
            Schau spaeter wieder vorbei, dann warten neue Trainingspartner auf
            dich.
          </Text>
        </View>
      ) : failedToLoad ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Verbindungsfehler</Text>
          <Text style={styles.helper}>
            Kandidaten konnten nicht geladen werden.
          </Text>
          <Pressable style={styles.secondary} onPress={() => void loadCandidates(cursor)}>
            <Text style={styles.secondaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : current ? (
        <>
          <View style={styles.matchCard}>
            <View style={styles.photo}>
              <Text style={styles.photoEmoji}>🏃</Text>
              <Pressable style={styles.cardMenuButton} onPress={() => openCardMenu(current)}>
                <Text style={styles.cardMenuButtonText}>⋯</Text>
              </Pressable>
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardName}>{current.name}</Text>
              <Text style={styles.cardMeta}>
                {current.sport} · {current.level}
              </Text>
              {current.bio && (
                <View style={styles.tags}>
                  <Text style={styles.tag}>{current.bio}</Text>
                </View>
              )}
            </View>
          </View>
          {swipeError && (
            <Text style={styles.errorText}>{swipeError}</Text>
          )}
          <View style={styles.actions}>
            <Pressable style={styles.pass} onPress={() => swipe("pass")} disabled={submitting}>
              <Text style={styles.actionText}>×</Text>
            </Pressable>
            <Pressable style={styles.like} onPress={() => swipe("like")} disabled={submitting}>
              <Text style={styles.likeText}>♥</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <View style={styles.empty}>
          <ActivityIndicator color={C.ink} />
        </View>
      )}
    </ScrollView>
  );
}
const matchAvatarColors = [C.ember, "#69B7EA", "#A98BEE"];
function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Jetzt";
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return `vor ${days} Tg.`;
}
function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}
// Caps the per-poll catch-up loop so a server cursor that never resolves to
// null (or a message rate outpacing the client) can't page indefinitely.
const MAX_POLL_PAGES = 25;
function MatchesList() {
  const auth = useContext(AuthContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [conversationsList, setConversationsList] = useState<ConversationSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      apiRequest<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        "/v1/conversations",
        auth,
      )
        .then((response) => {
          if (cancelled) return;
          setConversationsList(response.conversations);
          setNextCursor(response.nextCursor);
        })
        .catch(() => {
          if (!cancelled) {
            setConversationsList([]);
            setNextCursor(null);
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [auth.token, auth.userId]),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await apiRequest<{ conversations: ConversationSummary[]; nextCursor: string | null }>(
        `/v1/conversations?cursor=${encodeURIComponent(nextCursor)}`,
        auth,
      );
      setConversationsList((current) => [...current, ...response.conversations]);
      setNextCursor(response.nextCursor);
    } catch {
      // leave nextCursor as-is so the user can tap "Mehr laden" again
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Chats" />
      {loading ? (
        <ActivityIndicator color={C.ink} />
      ) : conversationsList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Noch keine Matches</Text>
          <Text style={styles.helper}>
            Sobald es ein Match gibt, taucht es hier auf.
          </Text>
        </View>
      ) : (
        <>
          {conversationsList.map((item, index) => (
            <Pressable
              style={styles.chatRow}
              key={item.conversationId}
              onPress={() =>
                navigation.navigate("Conversation", {
                  conversationId: item.conversationId,
                  name: item.name,
                  userId: item.userId,
                })
              }
            >
              <View
                style={[
                  styles.avatar,
                  { backgroundColor: matchAvatarColors[index % matchAvatarColors.length] },
                ]}
              >
                <Text style={styles.avatarLetter}>{item.name[0]?.toUpperCase()}</Text>
              </View>
              <View style={styles.chatInfo}>
                <Text style={styles.chatName}>{item.name}</Text>
                <Text style={styles.chatPreview} numberOfLines={1}>
                  {item.lastMessage ? item.lastMessage.body : "Sag Hallo 👋"}
                </Text>
              </View>
              <Text style={styles.chatTime}>{formatRelativeTime(item.updatedAt)}</Text>
            </Pressable>
          ))}
          {nextCursor && (
            <Pressable style={styles.secondary} onPress={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <ActivityIndicator color={C.ink} />
              ) : (
                <Text style={styles.secondaryText}>Mehr laden</Text>
              )}
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

function ConversationScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Conversation">) {
  const { conversationId, name, userId: otherUserId } = route.params;
  const auth = useContext(AuthContext);
  const profile = useContext(ProfileContext);
  const [messagesList, setMessagesList] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const messageIdsRef = useRef<Set<string>>(new Set());
  const unavailableRef = useRef(false);

  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  function sortMessages(list: ConversationMessage[]) {
    return [...list].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.messageId < b.messageId ? -1 : 1;
    });
  }

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest<{ messages: ConversationMessage[]; nextCursor: string | null }>(
        `/v1/conversations/${conversationId}/messages`,
        auth,
      );
      const ordered = sortMessages(response.messages);
      setMessagesList(ordered);
      messageIdsRef.current = new Set(ordered.map((message) => message.messageId));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        markUnavailable();
      } else {
        setMessagesList([]);
        messageIdsRef.current = new Set();
      }
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, conversationId, markUnavailable]);

  // Keeps paging through older messages (via nextCursor) until it reaches one
  // already held locally, so a burst of >1 page of messages between polls isn't
  // silently dropped; merges purely by messageId rather than a createdAt
  // comparison so same-millisecond messages from different senders can't collide.
  // Bounded by MAX_POLL_PAGES so a cursor that never resolves to null (server bug)
  // or a message rate that outpaces paging can't turn this into an infinite loop.
  const poll = useCallback(async () => {
    if (unavailableRef.current) return;
    try {
      const known = messageIdsRef.current;
      const collected: ConversationMessage[] = [];
      let cursor: string | null = null;
      let reachedKnown = false;
      for (let page = 0; page < MAX_POLL_PAGES; page += 1) {
        const path: string = cursor
          ? `/v1/conversations/${conversationId}/messages?cursor=${encodeURIComponent(cursor)}`
          : `/v1/conversations/${conversationId}/messages`;
        const response = await apiRequest<{ messages: ConversationMessage[]; nextCursor: string | null }>(
          path,
          auth,
        );
        for (const message of response.messages) {
          if (known.has(message.messageId)) {
            reachedKnown = true;
            break;
          }
          collected.push(message);
        }
        if (reachedKnown || !response.nextCursor) break;
        cursor = response.nextCursor;
      }

      if (collected.length === 0) return;
      setMessagesList((current) => {
        const currentIds = new Set(current.map((message) => message.messageId));
        const additions = collected.filter((message) => !currentIds.has(message.messageId));
        if (additions.length === 0) return current;
        const merged = sortMessages([...current, ...additions]);
        messageIdsRef.current = new Set(merged.map((message) => message.messageId));
        return merged;
      });
    } catch (caught) {
      // a 404 (e.g. the other side just blocked us) stops polling; other
      // transient errors are swallowed since the next tick may succeed
      if (caught instanceof ApiError && caught.status === 404) markUnavailable();
    }
  }, [auth.token, auth.userId, conversationId, markUnavailable]);

  useFocusEffect(
    useCallback(() => {
      void loadInitial();
      // Guards against overlapping ticks if a poll (e.g. a slow response, or the
      // multi-page catch-up loop above) takes longer than the interval itself.
      let pollInFlight = false;
      const interval = setInterval(() => {
        if (unavailableRef.current) {
          clearInterval(interval);
          return;
        }
        if (pollInFlight) return;
        pollInFlight = true;
        void poll().finally(() => {
          pollInFlight = false;
        });
      }, 4000);
      return () => clearInterval(interval);
    }, [loadInitial, poll]),
  );

  const send = async () => {
    const body = draft.trim();
    if (!body || body.length > 2000 || sending) return;
    setSending(true);
    setError(null);
    try {
      const message = await apiRequest<ConversationMessage>(
        `/v1/conversations/${conversationId}/messages`,
        auth,
        { method: "POST", body: JSON.stringify({ body }) },
      );
      setMessagesList((current) => [...current, message]);
      messageIdsRef.current.add(message.messageId);
      setDraft("");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        markUnavailable();
      } else {
        setError(describeApiError(caught, caught instanceof Error ? caught.message : "Senden fehlgeschlagen"));
      }
    } finally {
      setSending(false);
    }
  };

  const blockConversationPartner = async () => {
    setError(null);
    try {
      await apiRequest("/v1/blocks", auth, {
        method: "POST",
        body: JSON.stringify({ userId: otherUserId }),
      });
      navigation.navigate("Main", { screen: "Chats" });
    } catch (caught) {
      setError(describeApiError(caught, "Blockieren fehlgeschlagen, bitte erneut versuchen"));
    }
  };

  const confirmBlockPartner = () => {
    Alert.alert(`${name} blockieren?`, "Die Unterhaltung wird danach nicht mehr angezeigt.", [
      { text: "Abbrechen", style: "cancel" },
      { text: "Blockieren", style: "destructive", onPress: () => void blockConversationPartner() },
    ]);
  };

  const openMenu = () => {
    Alert.alert(name, undefined, [
      {
        text: "Melden",
        onPress: () => navigation.navigate("Report", { userId: otherUserId, name }),
      },
      { text: "Blockieren", style: "destructive", onPress: confirmBlockPartner },
      { text: "Abbrechen", style: "cancel" },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.conversationHeader}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.backArrow}>‹</Text>
          </Pressable>
          <Text style={styles.headerTitle}>{name}</Text>
          <Pressable onPress={openMenu} style={styles.backButton} disabled={unavailable}>
            {!unavailable && <Text style={styles.cardMenuButtonText}>⋯</Text>}
          </Pressable>
        </View>
        {unavailable ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nicht mehr verfuegbar</Text>
            <Text style={styles.helper}>Diese Unterhaltung ist nicht mehr verfuegbar.</Text>
            <Pressable
              style={styles.secondary}
              onPress={() => navigation.navigate("Main", { screen: "Chats" })}
            >
              <Text style={styles.secondaryText}>Zurueck zu den Chats</Text>
            </Pressable>
          </View>
        ) : loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={C.ink} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.messageList}>
            {messagesList.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Sag Hallo 👋</Text>
                <Text style={styles.helper}>Schreib die erste Nachricht.</Text>
              </View>
            ) : (
              messagesList.map((message) => (
                <View
                  key={message.messageId}
                  style={[
                    styles.messageBubble,
                    message.senderUserId === profile?.userId
                      ? styles.messageBubbleOwn
                      : styles.messageBubbleOther,
                  ]}
                >
                  <Text style={styles.messageText}>{message.body}</Text>
                  <Text style={styles.messageTime}>{formatMessageTime(message.createdAt)}</Text>
                </View>
              ))
            )}
          </ScrollView>
        )}
        {!unavailable && error && <Text style={styles.errorText}>{error}</Text>}
        {!unavailable && (
          <View style={styles.composer}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Nachricht schreiben..."
              placeholderTextColor={C.mist}
              style={styles.composerInput}
              maxLength={2000}
              multiline
            />
            <Pressable style={styles.sendButton} onPress={send} disabled={sending || !draft.trim()}>
              <Text style={styles.sendButtonText}>{sending ? "..." : "➤"}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}


const eventMonthNames = ["Jan", "Feb", "Maer", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
function formatEventDay(iso: string) {
  return String(new Date(iso).getDate()).padStart(2, "0");
}
function formatEventMonth(iso: string) {
  return eventMonthNames[new Date(iso).getMonth()];
}
function formatEventTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
function eventJoinLabel(event: EventSummary) {
  if (event.isCreator) return "Gastgeber";
  if (event.isAttending) return "Dabei ✓";
  if (event.spotsLeft === 0) return "Ausgebucht";
  return "Beitreten";
}

function Events() {
  const auth = useContext(AuthContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
  const [eventsList, setEventsList] = useState<EventSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cityFilter, setCityFilter] = useState("");
  const [sportFilter, setSportFilter] = useState<string | null>(null);
  const [actionErrorEventId, setActionErrorEventId] = useState<string | null>(null);
  const [actionErrorMessage, setActionErrorMessage] = useState("Aktion fehlgeschlagen, bitte erneut versuchen");
  const [pendingEventIds, setPendingEventIds] = useState<Set<string>>(new Set());

  const buildEventsPath = useCallback(
    (cursor: string | null) => {
      const params: string[] = [];
      if (cityFilter.trim()) params.push(`city=${encodeURIComponent(cityFilter.trim())}`);
      if (sportFilter) params.push(`sport=${encodeURIComponent(sportFilter)}`);
      if (cursor) params.push(`cursor=${encodeURIComponent(cursor)}`);
      return params.length > 0 ? `/v1/events?${params.join("&")}` : "/v1/events";
    },
    [cityFilter, sportFilter],
  );

  const loadEvents = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiRequest<{ events: EventSummary[]; nextCursor: string | null }>(
        buildEventsPath(null),
        auth,
      );
      setEventsList(response.events);
      setNextCursor(response.nextCursor);
    } catch {
      setEventsList([]);
      setNextCursor(null);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, buildEventsPath]);

  // Re-runs whenever the filters change (not just on tab focus), since
  // useFocusEffect re-invokes its callback immediately when already focused.
  useFocusEffect(
    useCallback(() => {
      void loadEvents();
    }, [loadEvents]),
  );

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await apiRequest<{ events: EventSummary[]; nextCursor: string | null }>(
        buildEventsPath(nextCursor),
        auth,
      );
      setEventsList((current) => [...current, ...response.events]);
      setNextCursor(response.nextCursor);
    } catch {
      // leave nextCursor as-is so the user can tap "Mehr laden" again
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleAttendance = async (event: EventSummary) => {
    if (pendingEventIds.has(event.eventId)) return;
    setActionErrorEventId(null);
    setPendingEventIds((current) => new Set(current).add(event.eventId));
    const path = event.isAttending
      ? `/v1/events/${event.eventId}/leave`
      : `/v1/events/${event.eventId}/join`;
    setEventsList((current) =>
      current.map((item) =>
        item.eventId === event.eventId
          ? {
              ...item,
              isAttending: !event.isAttending,
              attendeeCount: item.attendeeCount + (event.isAttending ? -1 : 1),
              spotsLeft: item.spotsLeft + (event.isAttending ? 1 : -1),
            }
          : item,
      ),
    );
    try {
      const updated = await apiRequest<EventSummary>(path, auth, { method: "POST" });
      setEventsList((current) =>
        current.map((item) => (item.eventId === event.eventId ? updated : item)),
      );
    } catch (caught) {
      setEventsList((current) =>
        current.map((item) => (item.eventId === event.eventId ? event : item)),
      );
      setActionErrorMessage(describeApiError(caught, "Aktion fehlgeschlagen, bitte erneut versuchen"));
      setActionErrorEventId(event.eventId);
    } finally {
      setPendingEventIds((current) => {
        const next = new Set(current);
        next.delete(event.eventId);
        return next;
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Header title="Events" actionIcon="+" onAction={() => navigation.navigate("CreateEvent")} />
      <TextInput
        value={cityFilter}
        onChangeText={setCityFilter}
        placeholder="Nach Ort filtern"
        placeholderTextColor={C.mist}
        style={[styles.input, { marginBottom: 12 }]}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        <Chip label="Alle" selected={sportFilter === null} onPress={() => setSportFilter(null)} />
        {sports.map((item) => (
          <Chip
            key={item}
            label={item}
            selected={sportFilter === item}
            onPress={() => setSportFilter(item)}
          />
        ))}
      </ScrollView>
      {loading ? (
        <ActivityIndicator color={C.ink} />
      ) : loadError ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Verbindungsfehler</Text>
          <Text style={styles.helper}>Events konnten nicht geladen werden.</Text>
          <Pressable style={styles.secondary} onPress={() => void loadEvents()}>
            <Text style={styles.secondaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : eventsList.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Keine Events gefunden</Text>
          <Text style={styles.helper}>
            Erstelle das erste Event ueber den Plus-Button oben.
          </Text>
        </View>
      ) : (
        <>
          {eventsList.map((item) => (
            <Pressable
              style={styles.event}
              key={item.eventId}
              onPress={() => navigation.navigate("EventDetail", { eventId: item.eventId })}
            >
              <View style={styles.eventTop}>
                <View style={styles.date}>
                  <Text style={styles.dateNumber}>{formatEventDay(item.startsAt)}</Text>
                  <Text style={styles.dateMonth}>{formatEventMonth(item.startsAt)}</Text>
                </View>
                <View style={styles.flex}>
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  <Text style={styles.eventMeta}>
                    {formatEventTime(item.startsAt)} · {item.city}
                  </Text>
                </View>
              </View>
              <View style={styles.eventFooter}>
                <Text style={styles.helper}>
                  {item.attendeeCount}/{item.capacity} · {item.spotsLeft} frei
                </Text>
                <Pressable
                  style={[
                    styles.join,
                    item.isAttending && styles.joinActive,
                    !item.isAttending && item.spotsLeft === 0 && styles.joinDisabled,
                  ]}
                  onPress={() => void toggleAttendance(item)}
                  disabled={
                    item.isCreator ||
                    pendingEventIds.has(item.eventId) ||
                    (!item.isAttending && item.spotsLeft === 0)
                  }
                >
                  <Text
                    style={[
                      styles.joinText,
                      item.isAttending && styles.joinActiveText,
                      !item.isAttending && item.spotsLeft === 0 && styles.joinDisabledText,
                    ]}
                  >
                    {eventJoinLabel(item)}
                  </Text>
                </Pressable>
              </View>
              {actionErrorEventId === item.eventId && (
                <Text style={styles.errorText}>{actionErrorMessage}</Text>
              )}
            </Pressable>
          ))}
          {nextCursor && (
            <Pressable style={styles.secondary} onPress={loadMore} disabled={loadingMore}>
              {loadingMore ? (
                <ActivityIndicator color={C.ink} />
              ) : (
                <Text style={styles.secondaryText}>Mehr laden</Text>
              )}
            </Pressable>
          )}
        </>
      )}
    </ScrollView>
  );
}

function CreateEventScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "CreateEvent">) {
  const auth = useContext(AuthContext);
  const profile = useContext(ProfileContext);
  const [title, setTitle] = useState("");
  const [sport, setSport] = useState(sports[0]);
  const [city, setCity] = useState(profile?.city ?? "");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState("10");
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
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
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
        <Pressable style={styles.primary} onPress={submit} disabled={submitting}>
          <Text style={styles.primaryText}>
            {submitting ? "Wird erstellt..." : "Event erstellen"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function EventDetailScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "EventDetail">) {
  const { eventId } = route.params;
  const auth = useContext(AuthContext);
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await apiRequest<EventDetail>(`/v1/events/${eventId}`, auth);
      setEvent(response);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth.token, auth.userId, eventId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleAttendance = async () => {
    if (!event || submitting) return;
    const previous = event;
    const path = previous.isAttending
      ? `/v1/events/${eventId}/leave`
      : `/v1/events/${eventId}/join`;
    setSubmitting(true);
    setActionError(null);
    setEvent({
      ...previous,
      isAttending: !previous.isAttending,
      attendeeCount: previous.attendeeCount + (previous.isAttending ? -1 : 1),
      spotsLeft: previous.spotsLeft + (previous.isAttending ? 1 : -1),
    });
    try {
      const updated = await apiRequest<EventSummary>(path, auth, { method: "POST" });
      setEvent((current) => (current ? { ...current, ...updated } : current));
    } catch (caught) {
      setEvent(previous);
      setActionError(describeApiError(caught, "Aktion fehlgeschlagen, bitte erneut versuchen"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.conversationHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Event</Text>
        <View style={styles.backButton} />
      </View>
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator color={C.ink} />
        </View>
      ) : loadError || !event ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Event nicht gefunden</Text>
          <Pressable style={styles.secondary} onPress={() => void load()}>
            <Text style={styles.secondaryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.screen}>
          <Text style={styles.title}>{event.title}</Text>
          <Text style={styles.helper}>
            {formatEventDay(event.startsAt)}. {formatEventMonth(event.startsAt)} ·{" "}
            {formatEventTime(event.startsAt)} · {event.city}
          </Text>
          <Text style={styles.label}>Sportart</Text>
          <Text style={styles.cardMeta}>{event.sport}</Text>
          {event.description && (
            <>
              <Text style={styles.label}>Beschreibung</Text>
              <Text style={styles.cardMeta}>{event.description}</Text>
            </>
          )}
          <Text style={styles.label}>Veranstalter</Text>
          <Text style={styles.cardMeta}>{event.creatorName}</Text>
          <Text style={styles.label}>Plaetze</Text>
          <Text style={styles.cardMeta}>
            {event.attendeeCount}/{event.capacity} belegt · {event.spotsLeft} frei
          </Text>
          {actionError && (
            <Text style={styles.errorText}>{actionError}</Text>
          )}
          <Pressable
            style={[
              styles.join,
              styles.eventDetailJoin,
              event.isAttending && styles.joinActive,
              !event.isAttending && event.spotsLeft === 0 && styles.joinDisabled,
            ]}
            onPress={() => void toggleAttendance()}
            disabled={submitting || event.isCreator || (!event.isAttending && event.spotsLeft === 0)}
          >
            <Text
              style={[
                styles.joinText,
                event.isAttending && styles.joinActiveText,
                !event.isAttending && event.spotsLeft === 0 && styles.joinDisabledText,
              ]}
            >
              {eventJoinLabel(event)}
            </Text>
          </Pressable>
          <Text style={[styles.label, { marginTop: 24 }]}>Teilnehmer</Text>
          {event.attendees.map((attendee) => (
            <View style={styles.settings} key={attendee.userId}>
              <Text style={styles.settingsText}>{attendee.name}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function ProfileScreen() {
  const profile = useContext(ProfileContext);
  const { logout } = useContext(AuthActionsContext);
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, "Main">>();
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
      ].map((item) => (
        <View style={styles.settings} key={item}>
          <Text style={styles.settingsText}>{item}</Text>
          <Text style={styles.arrow}>›</Text>
        </View>
      ))}
      <Pressable style={styles.settings} onPress={() => navigation.navigate("Privacy")}>
        <Text style={styles.settingsText}>Daten & DSGVO</Text>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
      <Pressable style={styles.settings} onPress={logout}>
        <Text style={[styles.settingsText, { color: C.ember }]}>Abmelden</Text>
        <Text style={styles.arrow}>›</Text>
      </Pressable>
    </ScrollView>
  );
}

function PrivacyScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Privacy">) {
  const auth = useContext(AuthContext);
  const { logout } = useContext(AuthActionsContext);
  const [blockedList, setBlockedList] = useState<BlockedUser[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(true);
  const [blocksError, setBlocksError] = useState(false);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBlocks = useCallback(async () => {
    setLoadingBlocks(true);
    setBlocksError(false);
    try {
      const response = await apiRequest<{ blocked: BlockedUser[] }>("/v1/blocks", auth);
      setBlockedList(response.blocked);
    } catch {
      setBlocksError(true);
    } finally {
      setLoadingBlocks(false);
    }
  }, [auth.token, auth.userId]);

  useFocusEffect(
    useCallback(() => {
      void loadBlocks();
    }, [loadBlocks]),
  );

  const unblock = async (userId: string) => {
    if (unblockingUserId) return;
    setUnblockingUserId(userId);
    setUnblockError(null);
    const previous = blockedList;
    setBlockedList((current) => current.filter((item) => item.userId !== userId));
    try {
      await apiRequest(`/v1/blocks/${userId}`, auth, { method: "DELETE" });
    } catch (caught) {
      setBlockedList(previous);
      setUnblockError(describeApiError(caught, "Entblocken fehlgeschlagen, bitte erneut versuchen"));
    } finally {
      setUnblockingUserId(null);
    }
  };

  const deleteAccount = async () => {
    if (!confirmed || !password.trim() || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiRequest("/v1/me", auth, {
        method: "DELETE",
        body: JSON.stringify({ password }),
      });
      logout();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setDeleteError("Passwort ist falsch.");
      } else {
        setDeleteError(describeApiError(caught, "Konto konnte nicht geloescht werden"));
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.conversationHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Daten & DSGVO</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.label}>Blockierte Nutzer</Text>
        {loadingBlocks ? (
          <ActivityIndicator color={C.ink} />
        ) : blocksError ? (
          <Text style={styles.errorText}>Blockierte Nutzer konnten nicht geladen werden.</Text>
        ) : blockedList.length === 0 ? (
          <Text style={styles.helper}>Keine blockierten Nutzer.</Text>
        ) : (
          blockedList.map((item) => (
            <View style={styles.settings} key={item.userId}>
              <Text style={styles.settingsText}>{item.name}</Text>
              <Pressable
                onPress={() => void unblock(item.userId)}
                disabled={unblockingUserId === item.userId}
              >
                <Text style={[styles.settingsText, { color: C.ember }]}>
                  {unblockingUserId === item.userId ? "..." : "Entblocken"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
        {unblockError && <Text style={styles.errorText}>{unblockError}</Text>}
        <Text style={[styles.label, { marginTop: 32 }]}>Konto loeschen</Text>
        <Text style={styles.helper}>
          Diese Aktion ist endgueltig. Dein Profil wird anonymisiert, bestehende Matches,
          Chats und Events bleiben fuer andere Nutzer sichtbar.
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Passwort"
          placeholderTextColor={C.mist}
          style={[styles.input, { marginTop: 14 }]}
          secureTextEntry
        />
        <Checkbox
          checked={confirmed}
          onPress={() => setConfirmed((value) => !value)}
          label="Ich verstehe, dass die Loeschung endgueltig ist."
        />
        {deleteError && <Text style={styles.errorText}>{deleteError}</Text>}
        <Pressable
          style={[styles.primary, styles.dangerButton]}
          onPress={() => void deleteAccount()}
          disabled={deleting || !password.trim() || !confirmed}
        >
          <Text style={styles.dangerButtonText}>
            {deleting ? "Wird geloescht..." : "Konto endgueltig loeschen"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportScreen({
  route,
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Report">) {
  const { userId, name } = route.params;
  const auth = useContext(AuthContext);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reasons: { value: ReportReason; label: string }[] = [
    { value: "spam", label: "Spam" },
    { value: "harassment", label: "Belaestigung" },
    { value: "fake_profile", label: "Fake-Profil" },
    { value: "inappropriate_content", label: "Unangemessene Inhalte" },
    { value: "other", label: "Sonstiges" },
  ];

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiRequest("/v1/reports", auth, {
        method: "POST",
        body: JSON.stringify({ userId, reason, note: note.trim() || undefined }),
      });
      if (alsoBlock) {
        await apiRequest("/v1/blocks", auth, {
          method: "POST",
          body: JSON.stringify({ userId }),
        });
      }
      navigation.goBack();
    } catch (caught) {
      setError(describeApiError(caught, "Meldung konnte nicht gesendet werden"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.conversationHeader}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backArrow}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Melden</Text>
        <View style={styles.backButton} />
      </View>
      <ScrollView contentContainerStyle={styles.setup}>
        <Text style={styles.helper}>{name} melden</Text>
        <Text style={styles.label}>Grund</Text>
        <View style={styles.chips}>
          {reasons.map((item) => (
            <Chip
              key={item.value}
              label={item.label}
              selected={reason === item.value}
              onPress={() => setReason(item.value)}
            />
          ))}
        </View>
        <Text style={styles.label}>Hinweis (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="Weitere Details..."
          placeholderTextColor={C.mist}
          style={[styles.input, styles.multilineInput]}
          maxLength={1000}
          multiline
        />
        <Checkbox
          checked={alsoBlock}
          onPress={() => setAlsoBlock((value) => !value)}
          label="Nutzer zusaetzlich blockieren"
        />
        {error && <Text style={styles.errorText}>{error}</Text>}
        <Pressable style={styles.primary} onPress={() => void submit()} disabled={submitting}>
          <Text style={styles.primaryText}>{submitting ? "Wird gesendet..." : "Melden"}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
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
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.court,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: { backgroundColor: C.ink, borderColor: C.ink },
  checkboxMark: { color: C.volt, fontSize: 13, fontWeight: "800" },
  checkboxLabel: { color: C.ink, fontSize: 13, flex: 1, lineHeight: 18 },
  dangerButton: { backgroundColor: C.ember },
  dangerButtonText: { color: C.court, fontSize: 15, fontWeight: "800" },
  cardMenuButton: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.court,
    alignItems: "center",
    justifyContent: "center",
  },
  cardMenuButtonText: { color: C.ink, fontSize: 18, fontWeight: "800" },
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
  joinActive: { backgroundColor: C.volt },
  joinActiveText: { color: C.ink },
  joinDisabled: { backgroundColor: C.line },
  joinDisabledText: { color: C.mist },
  eventDetailJoin: { alignSelf: "flex-start", marginTop: 16 },
  multilineInput: { height: 100, paddingTop: 14, textAlignVertical: "top" },
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
  conversationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  backButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  backArrow: { color: C.ink, fontSize: 26, fontWeight: "800" },
  messageList: { flexGrow: 1, padding: 18, gap: 10 },
  messageBubble: {
    maxWidth: "80%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  messageBubbleOwn: {
    alignSelf: "flex-end",
    backgroundColor: C.ember,
  },
  messageBubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: C.court,
    borderWidth: 1,
    borderColor: C.line,
  },
  messageText: { color: C.ink, fontSize: 14, lineHeight: 19 },
  messageTime: { color: C.mist, fontSize: 10, marginTop: 5, alignSelf: "flex-end" },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.court,
  },
  composerInput: {
    flex: 1,
    backgroundColor: C.cloud,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: C.ink,
    fontSize: 14,
    maxHeight: 110,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonText: { color: C.volt, fontSize: 18, fontWeight: "800" },
});
