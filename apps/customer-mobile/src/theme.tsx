import { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";

import { palettes, type Palette, type Scheme } from "./tokens.generated";

/**
 * Colour, type and spacing, from the web's design tokens.
 *
 * `tokens.generated.ts` is written by scripts/generate-app-theme.mjs out of
 * app/globals.css, which stays the single source of truth for the palette. The
 * type scale and radii below live here because they are the app's own — the web
 * expresses them as Tailwind utilities, which do not cross over.
 *
 * The palette was hand-copied at first and drifted within a day: the brand red
 * was #9E3136 here and #ce3f23 on the web. Nothing looked broken, which is
 * exactly how that fails.
 */

export interface Theme {
  scheme: Scheme;
  c: Palette;
}

const ThemeContext = createContext<Theme>({ scheme: "light", c: palettes.light });

/**
 * Follows the device.
 *
 * No in-app toggle: somebody who has set their phone to dark at night has
 * already answered this question, and asking again in a bakery app is a setting
 * nobody wants to maintain.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme: Scheme = useColorScheme() === "dark" ? "dark" : "light";
  const value = useMemo(() => ({ scheme, c: palettes[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);

/** Shorthand for the common case of only wanting colours. */
export const useColors = (): Palette => useContext(ThemeContext).c;

/**
 * Type.
 *
 * Bebas Neue for display, Poppins for everything else — the same pairing as the
 * web. Bebas ships a single 400 weight, so display text must never ask for a
 * heavier one or the system synthesises a fake bold that looks nothing like the
 * real face.
 */
export const font = {
  display: "BebasNeue_400Regular",
  regular: "Poppins_400Regular",
  medium: "Poppins_500Medium",
  semibold: "Poppins_600SemiBold",
  light: "Poppins_300Light",
} as const;

/** Poppins is set slightly tight throughout, matching the web's -0.015em. */
export const TRACKING = -0.2;

export const radius = {
  chip: 999,
  card: 20,
  cardLarge: 28,
  control: 16,
  sheet: 30,
} as const;

/**
 * Card and brand-button shadows.
 *
 * iOS takes offset/opacity/radius; Android only reads elevation. Both are given
 * so a card does not float on one platform and sit flat on the other. In dark
 * mode the shadows go stronger and pure black, because a soft grey shadow on a
 * near-black canvas is invisible and the card loses its edge.
 */
export function shadows(scheme: Scheme) {
  const dark = scheme === "dark";
  return {
    card: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: dark ? 0.45 : 0.06,
      shadowRadius: 8,
      elevation: 2,
    },
    raised: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: dark ? 0.55 : 0.14,
      shadowRadius: 24,
      elevation: 8,
    },
    brand: {
      shadowColor: palettes[scheme].brand,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: dark ? 0.36 : 0.3,
      shadowRadius: 16,
      elevation: 6,
    },
  } as const;
}
