import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { shadows, useTheme } from "../theme";
import { BrandWash } from "./gradient";
import { Medallion } from "./medallion";
import { Display, Overline } from "./text";

/** The mark's diameter, matching the splash plugin's imageWidth exactly. */
const MARK = 120;

/* The beats. Total is LAUNCH_MS, which App waits out before it navigates. */
const HOLD_MS = 200; // the splash pose, untouched, so the handoff is invisible
const WASH_MS = 700; // brand colour floods out from behind the mark
const WORD_AT = 620; // wordmark starts before the wash lands, so they overlap
const WORD_MS = 520;
export const LAUNCH_MS = 2400;
/** How long the finished card lingers over the app before it is gone. */
export const CURTAIN_MS = 420;

/**
 * The opening title card.
 *
 * Starts as an exact copy of the native splash — cream, mark at 120, dead
 * still — so the moment React takes the screen back nothing appears to happen.
 * Then the brand floods out from behind the mark to fill the screen, the
 * medallion lifts and begins to turn, and the name rises underneath.
 *
 * The wash is a circle scaled from the mark's own footprint to the screen's
 * diagonal, which is why it reads as coming *out of* the coin rather than
 * merely appearing behind it. It carries the same radial gradient as the home
 * hero, so it scales out to exactly the surface the app opens on.
 */
export function LaunchScreen({ frozen = false }: { frozen?: boolean }) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);
  const { width, height } = useWindowDimensions();
  const reveal = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);
  /* Dark icons over the cream hold, light once the red arrives. Switching with
     the wash rather than up front avoids a beat of invisible status bar. */
  const [onRed, setOnRed] = useState(false);

  useEffect(() => {
    if (frozen) return setOnRed(true);
    const t = setTimeout(() => setOnRed(true), HOLD_MS);
    return () => clearTimeout(t);
  }, [frozen]);

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
    /* `frozen` is the curtain: a second copy held on the last frame while it
       fades over the app, so the card dissolves instead of cutting. */
    if (still || frozen) {
      /* Reduce Motion gets the composition, not the choreography: the same
         final frame, arrived at without anything travelling. */
      reveal.setValue(1);
      word.setValue(1);
      return;
    }
    const run = Animated.parallel([
      Animated.sequence([
        Animated.delay(HOLD_MS),
        Animated.timing(reveal, {
          toValue: 1,
          duration: WASH_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.sequence([
        Animated.delay(WORD_AT),
        Animated.timing(word, {
          toValue: 1,
          duration: WORD_MS,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);
    run.start();
    return () => run.stop();
  }, [frozen, reveal, still, word]);

  /* A circle big enough that its edge clears every corner at scale 1. */
  const span = Math.hypot(width, height);

  return (
    <View style={{ flex: 1, backgroundColor: c.canvas, alignItems: "center", justifyContent: "center" }}>
      <StatusBar style={onRed || still ? "light" : "dark"} />
      <Animated.View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: span,
          height: span,
          left: (width - span) / 2,
          top: (height - span) / 2,
          borderRadius: span / 2,
          overflow: "hidden",
          transform: [
            {
              scale: reveal.interpolate({
                inputRange: [0, 1],
                /* Starts exactly the size of the mark, so the colour looks like
                   it was inside the coin all along. */
                outputRange: [MARK / span, 1],
              }),
            },
          ],
        }}
      >
        <BrandWash cx={0.5} cy={0.5} />
      </Animated.View>

      <Animated.View
        style={{
          alignItems: "center",
          transform: [
            {
              scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] }),
            },
          ],
        }}
      >
        {/* Rounded and raised so the coin still reads as an object once the
            background behind it is the same red it is made of. */}
        <View style={[{ borderRadius: MARK / 2 }, sh.raised]}>
          <Medallion size={MARK} />
        </View>

        <Animated.View
          style={{
            alignItems: "center",
            marginTop: 22,
            opacity: word,
            transform: [
              { translateY: word.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            ],
          }}
        >
          <Display size={34} color="#ffffff">
            Harina
          </Display>
          <Overline size={11} color="rgba(255,255,255,0.82)" style={{ marginTop: 2 }}>
            Bakeshoppe
          </Overline>
        </Animated.View>
      </Animated.View>
    </View>
  );
}
