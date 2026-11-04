import AsyncStorage from "@react-native-async-storage/async-storage";
import { NavigationContainer } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ThemeProvider, useTheme } from "./theme";
import { AuthActionsContext, AuthContext, ProfileContext } from "./context/AppContext";
import { apiRequest, createUserId } from "./lib/api";
import type { Auth, Profile } from "./lib/types";
import { RootStack, navigationRef } from "./navigation/navigators";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { SignupScreen } from "./screens/SignupScreen";
import { ForgotPasswordScreen } from "./screens/ForgotPasswordScreen";
import { ResetPasswordScreen } from "./screens/ResetPasswordScreen";
import { MainTabs } from "./screens/MainTabs";
import { ConversationScreen } from "./screens/ConversationScreen";
import { CreateEventScreen } from "./screens/CreateEventScreen";
import { EventDetailScreen } from "./screens/EventDetailScreen";
import { PrivacyScreen } from "./screens/PrivacyScreen";
import { ReportScreen } from "./screens/ReportScreen";

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

function AppInner() {
  const { palette: C, styles } = useTheme();
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
    updateProfile: (nextProfile: Profile) => {
      setProfile(nextProfile);
      void AsyncStorage.setItem("oursport-profile", JSON.stringify(nextProfile));
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
