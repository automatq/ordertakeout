import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

/**
 * Where each screen sits in the flow, so the app can tell forwards from back.
 *
 * A screen arriving slides in from the side it conceptually came from. Getting
 * that backwards is worse than no animation at all — it reads as the app losing
 * its place.
 */
const ORDER = [
  "shops",
  "home",
  "menu",
  "product",
  "cart",
  "pickup",
  "checkout",
  "confirm",
  "track",
  "account",
  "signin",
];

const orderOf = (key: string) => {
  const at = ORDER.indexOf(key);
  return at === -1 ? ORDER.length : at;
};

const DRIFT = 14;
const DURATION_MS = 220;

/**
 * The animation between screens.
 *
 * This app navigates by swapping one component for another, with no router and
 * so no transitions of its own — screens simply cut. That cut is the single
 * loudest thing separating it from something that feels native, and it is worst
 * on the ordering path where four screens go by in a few seconds.
 *
 * Incoming only. Holding the outgoing screen mounted long enough to animate it
 * out would mean two live screens, two sets of fetches, and a scroll position to
 * restore; a short fade up from a few points off-centre buys most of the
 * impression for none of that.
 */
export function ScreenTransition({ screenKey, children }: { screenKey: string; children: ReactNode }) {
  const progress = useRef(new Animated.Value(1)).current;
  const [phase, setPhase] = useState({ key: screenKey, dir: 1 });
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

  /* Derived during render rather than in an effect: an effect runs after the
     new screen has already painted, so the first frame would show it at rest
     and the animation would start by jumping it back. */
  if (phase.key !== screenKey) {
    setPhase({ key: screenKey, dir: orderOf(screenKey) >= orderOf(phase.key) ? 1 : -1 });
    progress.setValue(0);
  }

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [phase, progress]);

  /* Reduce Motion keeps the fade and drops the travel. A cross-fade is the
     substitution Apple asks for, not the absence of any change at all. */
  const drift = still ? 0 : DRIFT * phase.dir;

  return (
    <View style={{ flex: 1 }}>
      <Animated.View
        style={{
          flex: 1,
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [drift, 0],
              }),
            },
          ],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
