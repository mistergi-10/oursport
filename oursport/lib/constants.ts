import type { Ionicons } from "@expo/vector-icons";
import type { MainTabParamList } from "../navigation/types";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:10000";

export const tabIcons: Record<keyof MainTabParamList, keyof typeof Ionicons.glyphMap> = {
  Matching: "heart",
  Chats: "chatbubble-ellipses",
  Events: "calendar",
  Profile: "person-circle",
};
export const sports = [
  "Laufen",
  "Tennis",
  "Klettern",
  "Bouldern",
  "Yoga",
  "Pilates",
  "Fussball",
  "Handball",
  "Basketball",
  "Volleyball",
  "Badminton",
  "Tischtennis",
  "Squash",
  "Radfahren",
  "Mountainbiken",
  "Schwimmen",
  "Triathlon",
  "Wandern",
  "Kraftsport",
  "Crossfit",
  "Boxen",
  "Kampfsport",
  "Tanzen",
  "Reiten",
  "Golf",
  "Skifahren",
  "Snowboarden",
  "Eishockey",
  "Rudern",
  "Segeln",
  "Surfen",
  "Inlineskaten",
];
export const levels = ["Anfaenger", "Fortgeschritten", "Profi"];
