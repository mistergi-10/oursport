import type { Ionicons } from "@expo/vector-icons";
import type { MainTabParamList } from "../navigation/types";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:10000";

export const tabIcons: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  Matching: "heart",
  Chats: "chatbubble-ellipses",
  Events: "calendar",
  Profile: "person-circle",
};
export const tabLabels: Record<keyof MainTabParamList, string> = {
  Matching: "Matching",
  Chats: "Chats",
  Events: "Events",
  Profile: "Profil",
};
export const sports = ["Laufen", "Tennis", "Klettern", "Yoga", "Fussball", "Radfahren"];
export const levels = ["Anfaenger", "Fortgeschritten", "Profi"];
