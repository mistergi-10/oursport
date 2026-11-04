import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { MotiView } from "moti";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  SafeAreaView,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { BrandMark } from "../components/BrandMark";
import { Button } from "../components/Button";
import { useReducedMotion } from "../lib/reducedMotion";
import { useTheme } from "../theme";
import { spacing } from "../theme/tokens";

const ONBOARDING_SEEN_KEY = "hasSeenOnboarding";

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  badgeIcon: keyof typeof Ionicons.glyphMap;
  headline: string;
  body: string;
};

const slides: Slide[] = [
  {
    icon: "heart",
    badgeIcon: "fitness",
    headline: "Finde Trainingspartner, die zu dir passen",
    body: "Wische durch Profile aus deiner Naehe und matche mit Leuten, die genauso gern Sport machen wie du.",
  },
  {
    icon: "calendar",
    badgeIcon: "location",
    headline: "Entdecke Sport-Events in deiner Naehe",
    body: "Finde passende Aktivitaeten, tritt bei oder lass dir Wiederholungstermine direkt vorschlagen.",
  },
  {
    icon: "chatbubble-ellipses",
    badgeIcon: "heart",
    headline: "Chatte direkt nach dem Match",
    body: "Sobald es ein Match gibt, plant ihr sofort euer naechstes Training im Chat.",
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
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [slideIndex, setSlideIndex] = useState(0);

  const onMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setSlideIndex(index);
  };

  return (
    <SafeAreaView style={styles.safe}>
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
                <Text style={styles.title}>{slide.headline}</Text>
                <Text style={styles.tagline}>{slide.body}</Text>
              </MotiView>
              {isLast && (
                <View style={styles.onboardingActions}>
                  <Button label="Konto erstellen" onPress={onCreateAccount} />
                  <Button variant="secondary" label="Ich habe schon ein Konto" onPress={onLogin} />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.dotsRow}>
        {slides.map((slide, index) => (
          <View key={slide.headline} style={[styles.dot, index === slideIndex && styles.dotActive]} />
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
  const reducedMotion = useReducedMotion();
  const features: [keyof typeof Ionicons.glyphMap, string][] = [
    ["heart", "Finde Trainingspartner, die zu deinem Level passen"],
    ["chatbubble-ellipses", "Chatte direkt und plant euer naechstes Training"],
    ["calendar", "Entdecke lokale Sport-Events in deiner Naehe"],
  ];
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.welcome}>
        <MotiView
          from={reducedMotion ? undefined : { opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: "timing", duration: reducedMotion ? 0 : 420 }}
          style={styles.hero}
        >
          <BrandMark />
          <Text style={styles.wordmark}>Our Sport</Text>
          <Text style={styles.tagline}>
            Finde Trainingspartner in deiner Naehe. Sport macht zu zweit
            einfach mehr Spass.
          </Text>
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
        <Button label="Konto erstellen" onPress={onCreateAccount} />
        <Button
          variant="secondary"
          label="Ich habe schon ein Konto"
          onPress={onLogin}
          style={{ marginTop: spacing.md }}
        />
      </View>
    </SafeAreaView>
  );
}

