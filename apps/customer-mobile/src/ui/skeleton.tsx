import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";

import { radius, useTheme } from "../theme";

/**
 * A placeholder in the shape of the thing that is coming.
 *
 * Replaces a spinner on a blank screen. Neither is faster, but one tells you
 * what you are waiting for and roughly how much of it there is, and a screen
 * that resolves into itself feels quicker than one that appears from nothing.
 *
 * The pulse stops for Reduce Motion — a looping animation is exactly what that
 * setting is asking about, and a flat block still reads as a placeholder.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (active) setStill(on);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setStill);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 760,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, still]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { backgroundColor: c.surfaceSunken, borderRadius: radius.control },
        !still && { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
        style,
      ]}
    />
  );
}

/** The shape of a product card, for the menu while it loads. */
export function CardSkeleton({ imageHeight = 196 }: { imageHeight?: number }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        borderRadius: radius.cardLarge,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface,
        overflow: "hidden",
      }}
    >
      <Skeleton style={{ width: "100%", height: imageHeight, borderRadius: 0 }} />
      <View style={{ padding: 15, gap: 10 }}>
        <Skeleton style={{ width: "72%", height: 22 }} />
        <Skeleton style={{ width: "40%", height: 16 }} />
      </View>
    </View>
  );
}

/** The shape of the order screens: a header block over a tall panel. */
export function PanelSkeleton() {
  return (
    <View style={{ padding: 20, gap: 16 }}>
      <Skeleton style={{ width: "45%", height: 34 }} />
      <Skeleton style={{ width: "70%", height: 18 }} />
      <Skeleton style={{ width: "100%", height: 220, borderRadius: 26 }} />
      <Skeleton style={{ width: "100%", height: 120, borderRadius: 26 }} />
    </View>
  );
}
