import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createStyles } from "./styles";
import { lightPalette, darkPalette, type Palette } from "./tokens";

export type ColorScheme = "light" | "dark";
const THEME_STORAGE_KEY = "oursport-theme";

const ThemeContext = createContext<{
  palette: Palette;
  styles: ReturnType<typeof createStyles>;
  scheme: ColorScheme;
  toggleScheme: () => void;
}>({
  palette: lightPalette,
  styles: createStyles(lightPalette),
  scheme: "light",
  toggleScheme: () => undefined,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [scheme, setScheme] = useState<ColorScheme>("light");
  useEffect(() => {
    void AsyncStorage.getItem(THEME_STORAGE_KEY).then((stored) => {
      if (stored === "dark" || stored === "light") setScheme(stored);
    });
  }, []);
  const toggleScheme = useCallback(() => {
    setScheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      void AsyncStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  }, []);
  const palette = scheme === "dark" ? darkPalette : lightPalette;
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <ThemeContext.Provider value={{ palette, styles, scheme, toggleScheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
