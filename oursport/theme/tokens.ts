import { Platform, type ViewStyle } from "react-native";

// `ink`/`mist`/`cloud`/`court`/`line` flip between themes; a handful of brand
// surfaces (primary buttons, selected chips, the match overlay) intentionally
// stay a fixed near-black with volt text in both themes, so those few spots
// use the literal INK_FIXED/COURT_FIXED colors below instead of the palette.
export const INK_FIXED = "#12181A";
export const COURT_FIXED = "#FFFFFF";

export type Palette = {
  ink: string;
  cloud: string;
  court: string;
  volt: string;
  ember: string;
  mist: string;
  line: string;
};

export const lightPalette: Palette = {
  ink: "#12181A",
  cloud: "#F3F5EF",
  court: "#FFFFFF",
  volt: "#C6F24C",
  ember: "#FF5C39",
  // Darkened from #778078 — the original shade measured ~4.1:1 against `court`
  // and ~4.4:1 against `cloud`, both below the WCAG AA 4.5:1 body-text floor.
  mist: "#626B61",
  line: "#E1E6DD",
};
export const darkPalette: Palette = {
  ink: "#F3F5EF",
  cloud: "#12181A",
  court: "#1C2422",
  volt: "#C6F24C",
  ember: "#FF7A57",
  mist: "#8FA398",
  line: "#2B3634",
};

// Named type scale: every screen style references one of these steps instead
// of declaring its own fontSize/lineHeight/fontWeight. A handful of genuinely
// one-off hero glyphs (brand symbol, profile initial, placeholder emoji) are
// documented exceptions in theme/styles.ts rather than scale duplicates.
export const typography = {
  display: { fontSize: 40, lineHeight: 46, fontWeight: "800" },
  celebration: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  title: { fontSize: 25, lineHeight: 31, fontWeight: "800" },
  subtitle: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  heading: { fontSize: 21, lineHeight: 27, fontWeight: "800" },
  bodyLg: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  body: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
  bodySm: { fontSize: 14, lineHeight: 20, fontWeight: "600" },
  label: { fontSize: 13, lineHeight: 19, fontWeight: "700" },
  small: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: "700" },
  tiny: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

type ElevationLevel = 1 | 2 | 3;
const elevationConfig: Record<
  ElevationLevel,
  { elevation: number; shadowOpacity: number; shadowRadius: number; shadowOffsetY: number }
> = {
  1: { elevation: 2, shadowOpacity: 0.08, shadowRadius: 4, shadowOffsetY: 1 },
  2: { elevation: 5, shadowOpacity: 0.12, shadowRadius: 10, shadowOffsetY: 4 },
  3: { elevation: 10, shadowOpacity: 0.18, shadowRadius: 18, shadowOffsetY: 10 },
};

// Sets Android `elevation` and the iOS shadow* trio together (plus a
// `boxShadow` fallback on web, where the shadow* properties are not
// rendered), so card/overlay shadows are visible on every platform.
export function elevation(level: ElevationLevel): ViewStyle {
  const config = elevationConfig[level];
  const base: ViewStyle = {
    elevation: config.elevation,
    shadowColor: "#000000",
    shadowOpacity: config.shadowOpacity,
    shadowRadius: config.shadowRadius,
    shadowOffset: { width: 0, height: config.shadowOffsetY },
  };
  if (Platform.OS === "web") {
    return {
      ...base,
      // react-native-web maps boxShadow directly; RN's ViewStyle type doesn't
      // declare it, so it's added via a loose cast.
      ...({
        boxShadow: `0px ${config.shadowOffsetY}px ${config.shadowRadius}px rgba(0,0,0,${config.shadowOpacity})`,
      } as ViewStyle),
    };
  }
  return base;
}
