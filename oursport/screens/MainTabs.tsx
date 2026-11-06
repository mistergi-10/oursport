import { Ionicons } from "@expo/vector-icons";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { MotiView } from "moti";
import { useEffect, useState } from "react";
import { Pressable, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { Button } from "../components/Button";
import { Matching } from "./Matching";
import { MatchesList } from "./MatchesList";
import { Events } from "./Events";
import { ProfileScreen } from "./ProfileScreen";
import { tabIcons } from "../lib/constants";
import { hapticSuccess } from "../lib/haptics";
import { useReducedMotion } from "../lib/reducedMotion";
import type { MatchInfo } from "../lib/types";
import { useTheme } from "../theme";
import { MainTab } from "../navigation/navigators";
import type { MainTabParamList, RootStackParamList } from "../navigation/types";

// Route name -> translation key, since tab labels (unlike sports/levels) are
// display-only and carry no wire value that needs to stay stable.
const tabLabelKeys: Record<keyof MainTabParamList, string> = {
  Matching: "tabs.matching",
  Chats: "tabs.chats",
  Events: "tabs.events",
  Profile: "tabs.profile",
};

export function MainTabs({ navigation }: NativeStackScreenProps<RootStackParamList, "Main">) {
  const { palette: C, styles, scheme } = useTheme();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const [activeMatch, setActiveMatch] = useState<MatchInfo | null>(null);
  useEffect(() => {
    if (activeMatch) hapticSuccess();
  }, [activeMatch]);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
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
                {t(tabLabelKeys[route.name])}
              </Text>
            ),
            tabBarIcon: ({ color, focused }) => (
              <Ionicons
                name={focused ? tabIcons[route.name] : `${tabIcons[route.name]}-outline` as keyof typeof Ionicons.glyphMap}
                size={24}
                color={color}
              />
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
          <View style={styles.overlay} accessibilityViewIsModal importantForAccessibility="yes">
            <MotiView
              from={reducedMotion ? undefined : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "timing", duration: reducedMotion ? 0 : 280 }}
              style={styles.overlayCard}
            >
              <MotiView
                from={reducedMotion ? undefined : { scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={{ type: "timing", duration: reducedMotion ? 0 : 320, delay: reducedMotion ? 0 : 120 }}
              >
                <Ionicons name="heart" size={40} color={C.volt} />
              </MotiView>
              <Text style={styles.overlayTitle}>{t("mainTabs.matchTitle")}</Text>
              <Text style={styles.overlayBody}>
                {t("mainTabs.matchBody", { name: activeMatch.name, sport: activeMatch.sport })}
              </Text>
              <Button
                label={t("mainTabs.viewMatch")}
                onPress={() => {
                  const match = activeMatch;
                  setActiveMatch(null);
                  if (match?.conversationId) {
                    navigation.navigate("Conversation", {
                      conversationId: match.conversationId,
                      name: match.name,
                      userId: match.userId,
                    });
                  } else {
                    navigation.navigate("Main", { screen: "Chats" });
                  }
                }}
              />
              <Pressable onPress={() => setActiveMatch(null)}>
                <Text style={styles.dismiss}>{t("mainTabs.keepSwiping")}</Text>
              </Pressable>
            </MotiView>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
