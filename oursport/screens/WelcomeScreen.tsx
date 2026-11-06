import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { MotiView } from "moti";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";
import { useReducedMotion } from "../lib/reducedMotion";
import { localeDisplayNames, setLocale, supportedLocales } from "../lib/i18n";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";

const ONBOARDING_SEEN_KEY = "hasSeenOnboarding";

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  headline: string;
  body: string;
};

// Reused by both the first-launch carousel and the returning-user screen —
// visible pre-login per the requirements (not gated behind having an account).
function LanguageSwitcher() {
  const { styles } = useTheme();
  const { i18n } = useTranslation();
  return (
    <View style={[styles.filterRow, { flexDirection: "row" }]}>
      {supportedLocales.map((locale) => (
        <Chip
          key={locale}
          label={localeDisplayNames[locale]}
          selected={i18n.language === locale}
          onPress={() => void setLocale(locale)}
        />
      ))}
    </View>
  );
}

const slides: Slide[] = [
  {
    icon: "heart",
    badgeIcon: "fitness",
    headline: "welcome.slide1Headline",
    body: "welcome.slide1Body",
  },
  {
    icon: "calendar",
    badgeIcon: "location",
    headline: "welcome.slide2Headline",
    body: "welcome.slide2Body",
  },
  {
    icon: "chatbubble-ellipses",
    badgeIcon: "heart",
    headline: "welcome.slide3Headline",
    body: "welcome.slide3Body",
  },
];

export function WelcomeScreen({
  onCreateAccount,
  onLogin,
}: {
  onCreateAccount: () => void;
  onLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    void AsyncStorage.getItem(ONBOARDING_SEEN_KEY).then((value) => {
      setHasSeenOnboarding(value === "true");
    });
  }, []);

  if (hasSeenOnboarding === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={C.ink} />
      </View>
    );
  }

  if (hasSeenOnboarding) {
    return <ReturningWelcome onCreateAccount={onCreateAccount} onLogin={onLogin} />;
  }

  return (
    <OnboardingCarousel
      onCreateAccount={() => {
        void AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "true");
        onCreateAccount();
      }}
      onLogin={() => {
        void AsyncStorage.setItem(ONBOARDING_SEEN_KEY, "true");
        onLogin();
      }}
    />
  );
}

function OnboardingCarousel({
  onCreateAccount,
  onLogin,
}: {
  onCreateAccount: () => void;
  onLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [slideIndex, setSlideIndex] = useState(0);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setSlideIndex(index);
  };

  const goToSlide = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setSlideIndex(index);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <LanguageSwitcher />
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={styles.flex}
      >
        {slides.map((slide, index) => {
          const isLast = index === slides.length - 1;
          return (
            <View key={slide.headline} style={[styles.onboardingSlide, { width }]}>
              <MotiView
                from={reducedMotion ? undefined : { opacity: 0, translateY: 16 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: "timing", duration: reducedMotion ? 0 : 420 }}
                style={[styles.hero, { flex: 1, justifyContent: "center" }]}
              >
                <View style={styles.onboardingIllustration}>
                  <Ionicons name={slide.icon} size={64} color={C.ink} />
                  <View style={styles.brandDot}>
                    <Ionicons name={slide.badgeIcon} size={20} color={C.cloud} />
                  </View>
                </View>
                <Text style={styles.title} selectable={false}>{t(slide.headline)}</Text>
                <Text style={styles.tagline} selectable={false}>{t(slide.body)}</Text>
              </MotiView>
              {isLast ? (
                <View style={styles.onboardingActions}>
                  <Button label={t("welcome.createAccount")} onPress={onCreateAccount} />
                  <Button variant="secondary" label={t("welcome.haveAccount")} onPress={onLogin} />
                </View>
              ) : (
                <View style={styles.onboardingActions}>
                  <Button label={t("welcome.next")} onPress={() => goToSlide(index + 1)} />
                  <Pressable onPress={() => goToSlide(slides.length - 1)} accessibilityRole="button">
                    <Text style={styles.dismiss}>{t("welcome.skip")}</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.dotsRow}>
        {slides.map((slide, index) => (
          <Pressable
            key={slide.headline}
            onPress={() => goToSlide(index)}
            accessibilityRole="button"
            accessibilityLabel={t("welcome.goToSlide", { number: index + 1 })}
            hitSlop={8}
          >
            <View style={[styles.dot, index === slideIndex && styles.dotActive]} />
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function ReturningWelcome({
  onCreateAccount,
  onLogin,
}: {
  onCreateAccount: () => void;
  onLogin: () => void;
}) {
  const { palette: C, styles } = useTheme();
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const features: [keyof typeof Ionicons.glyphMap, string][] = [
    ["heart", t("welcome.feature1")],
    ["chatbubble-ellipses", t("welcome.feature2")],
    ["calendar", t("welcome.feature3")],
  ];
  return (
    <SafeAreaView style={styles.safe}>
      <LanguageSwitcher />
      <View style={styles.welcome}>
        <MotiView
          from={reducedMotion ? undefined : { opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: reducedMotion ? 0 : 420 }}
          style={styles.hero}
        >
          <BrandMark />
          <Text style={styles.wordmark}>Our Sport</Text>
          <Text style={styles.tagline}>{t("welcome.tagline")}</Text>
        </MotiView>
        <View style={styles.features}>
          {features.map(([icon, text]) => (
            <View style={styles.feature} key={text}>
              <View style={styles.featureIcon}>
                <Ionicons name={icon} size={20} color={C.ink} />
              </View>
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
        </View>
        <Button label={t("welcome.createAccount")} onPress={onCreateAccount} />
        <Button
          variant="secondary"
          label={t("welcome.haveAccount")}
          onPress={onLogin}
          style={{ marginTop: spacing.md }}
        />
      </View>
    </SafeAreaView>
  );
}

