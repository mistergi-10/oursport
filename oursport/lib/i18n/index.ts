import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Localization from "expo-localization";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const supportedLocales = ["de", "en", "fr"] as const;
export type SupportedLocale = (typeof supportedLocales)[number];

// Each language's own name, hardcoded in that language rather than
// translated (a standard i18n convention: a language name doesn't change
// depending on the currently active language).
export const localeDisplayNames: Record<SupportedLocale, string> = {
  de: "Deutsch",
  en: "English",
  fr: "Français",
};

const LOCALE_STORAGE_KEY = "oursport-locale";

function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return (supportedLocales as readonly string[]).includes(value ?? "");
}

void i18next.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
    fr: { translation: fr },
  },
  lng: "de",
  fallbackLng: "de",
  interpolation: { escapeValue: false },
});

// Resolves the active locale once on app start: the persisted manual choice if
// one exists, otherwise the device locale when it's one of the three supported
// ones, falling back to German — then persists whichever locale this resolves
// to, mirroring the "oursport-theme"/"hasSeenOnboarding" read-once pattern.
export async function initLocale() {
  const stored = await AsyncStorage.getItem(LOCALE_STORAGE_KEY);
  if (isSupportedLocale(stored)) {
    if (stored !== i18next.language) await i18next.changeLanguage(stored);
    return;
  }
  const deviceLocale = Localization.getLocales()[0]?.languageCode;
  const resolved = isSupportedLocale(deviceLocale) ? deviceLocale : "de";
  await i18next.changeLanguage(resolved);
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, resolved);
}

export async function setLocale(locale: SupportedLocale) {
  await i18next.changeLanguage(locale);
  await AsyncStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

// Looks up a canonical sports/levels value's display label for the active
// locale; falls back to the raw value itself if a locale file is ever missing
// an entry for it (e.g. a newly added sport not yet translated everywhere).
export function translateSport(sport: string) {
  return i18next.t(`sports.${sport}`, { defaultValue: sport });
}
export function translateLevel(level: string) {
  return i18next.t(`levels.${level}`, { defaultValue: level });
}

export default i18next;
