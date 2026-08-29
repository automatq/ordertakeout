import { Animated, type StyleProp, type ImageStyle as RNImageStyle } from "react-native";
import { Image as ExpoImage, type ImageSource } from "expo-image";

import { useColors } from "../theme";

/**
 * Product photography.
 *
 * `expo-image` rather than React Native's `Image` for two reasons that both
 * show up in a shop with one bar of signal. It caches to disk, so a menu
 * browsed this morning does not re-download every tray this afternoon; and it
 * fades in, so a slow photo arrives instead of appearing, which is the
 * difference between a screen that feels considered and one that flickers.
 *
 * The tinted box underneath is the placeholder. The API sends no blurhash, so
 * there is nothing better to show than the shape the photo will occupy — and a
 * shape is still better than a hole.
 */
const TRANSITION_MS = 220;

export function Photo({
  uri,
  style,
  accessibilityLabel,
}: {
  uri: string | null | undefined;
  style?: StyleProp<RNImageStyle>;
  accessibilityLabel?: string;
}) {
  const c = useColors();

  return (
    <ExpoImage
      source={uri ? { uri } : undefined}
      style={[{ backgroundColor: c.surfaceSunken }, style]}
      contentFit="cover"
      transition={TRANSITION_MS}
      cachePolicy="memory-disk"
      accessible={!!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** The same, for the hero slider, whose photos are driven by scroll position. */
export const AnimatedPhoto = Animated.createAnimatedComponent(ExpoImage);

export const photoDefaults = {
  contentFit: "cover",
  transition: TRANSITION_MS,
  cachePolicy: "memory-disk",
} as const;

export type { ImageSource };
