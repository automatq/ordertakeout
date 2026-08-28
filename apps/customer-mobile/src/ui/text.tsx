import { PixelRatio, Text, type StyleProp, type TextStyle } from "react-native";

import { font, TRACKING, useColors } from "../theme";

/**
 * The design's type scale.
 *
 * Display is Bebas Neue, uppercase, set tight — it is the bakery's voice and it
 * carries screen titles, prices and the order code. Everything else is Poppins.
 *
 * Bebas ships one weight. Nothing here may ask for a heavier one: the system
 * would synthesise a fake bold, which on a condensed face reads as a smear.
 *
 * ## Dynamic Type
 *
 * Content scales without limit — item names, prices, addresses, the sentence
 * telling you when to collect. That is the whole point of the setting and none
 * of it lives in a fixed box.
 *
 * Display and chrome are capped. A 56pt headline at 3× is 168pt, which is not
 * an accessible headline, it is one word per screen; and the tab bar reserves
 * its height as a constant, so labels that grow without bound would hide the
 * content underneath them. Capping is the honest trade: the text still grows,
 * just not past the point where the layout stops being a layout.
 */

/** Past this, display type stops being a heading and starts being a wall. */
export const DISPLAY_MAX_SCALE = 1.5;
/** Chrome whose height other things are laid out against. */
export const CHROME_MAX_SCALE = 1.3;

/**
 * The multiplier `Display` will actually render at.
 *
 * Anything positioning display type by hand — the two-line headlines that fake
 * the design's tight leading with a negative margin — has to compute from this
 * rather than from the literal size, or the type grows and the compensation
 * does not, and the lines overlap.
 */
export function displayScale(): number {
  return Math.min(PixelRatio.getFontScale(), DISPLAY_MAX_SCALE);
}

type Props = {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  color?: string;
  /** Cap Dynamic Type growth. Only for text something else is sized against. */
  maxScale?: number;
};

/** Screen titles and prices. Sizes match the prototype's 38/44/30/26/21. */
export function Display({ size = 38, children, style, color, numberOfLines }: Props & { size?: number }) {
  const c = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={DISPLAY_MAX_SCALE}
      style={[
        {
          fontFamily: font.display,
          fontSize: size,
          lineHeight: size * 0.98,
          textTransform: "uppercase",
          letterSpacing: 0.3,
          color: color ?? c.ink,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style, color, numberOfLines, size = 14, maxScale }: Props & { size?: number }) {
  const c = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          fontFamily: font.regular,
          fontSize: size,
          lineHeight: size * 1.55,
          letterSpacing: TRACKING,
          color: color ?? c.inkMuted,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Label({ children, style, color, numberOfLines, size = 14, maxScale }: Props & { size?: number }) {
  const c = useColors();
  return (
    <Text
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          fontFamily: font.medium,
          fontSize: size,
          letterSpacing: TRACKING,
          color: color ?? c.ink,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The small tracked-out uppercase run-in the design uses above every section.
 * Wide letterspacing is what makes it read as a label rather than shouting.
 */
export function Overline({ children, style, color, size = 11, maxScale }: Props & { size?: number }) {
  const c = useColors();
  return (
    <Text
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          fontFamily: font.semibold,
          fontSize: size,
          letterSpacing: 1.4,
          textTransform: "uppercase",
          color: color ?? c.inkSubtle,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/** Money and counts, so digits do not jitter as they change. */
export function Tabular({ children, style, color, size = 15, maxScale }: Props & { size?: number }) {
  const c = useColors();
  return (
    <Text
      maxFontSizeMultiplier={maxScale}
      style={[
        {
          fontFamily: font.medium,
          fontSize: size,
          letterSpacing: TRACKING,
          fontVariant: ["tabular-nums"],
          color: color ?? c.ink,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
