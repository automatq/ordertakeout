import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, View } from "react-native";

const SHEET = require("../../assets/medallion-sheet.webp");

/* Must match scripts/render-medallion.py. The sheet is a 6×6 grid of a single
   sine sway, so the last frame runs back into the first. */
const FRAMES = 36;
const COLS = 6;
const ROWS = 6;
const LOOP_MS = 2400;

/** Holds each cell, then jumps — an interpolation that steps instead of slides. */
function staircase(size: number) {
  const input: number[] = [];
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < FRAMES; i++) {
    /* Two points per frame, a hair apart: RN requires a strictly increasing
       input range, and holding a value needs both ends of its interval. */
    input.push(i, i + 0.9999);
    const left = -(i % COLS) * size;
    const top = -Math.floor(i / COLS) * size;
    x.push(left, left);
    y.push(top, top);
  }
  return { input, x, y };
}

/**
 * The crowned-H medallion, turning.
 *
 * A pre-rendered sprite sheet rather than a 3D scene. The source is a 28k-triangle
 * OBJ, and putting three.js and a GL context into the bundle to spin a logo would
 * cost more than everything else on this screen combined — so the turntable is
 * rasterised at build time and played back as frames.
 *
 * It sways rather than spins: the back of the medallion is a plain disc, so a
 * full revolution would show a featureless red circle for half of every loop.
 * A ±26° sway keeps the monogram legible while the light travels across the gold.
 */
export function Medallion({ size = 128 }: { size?: number }) {
  const frame = useRef(new Animated.Value(0)).current;
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
    if (still) {
      frame.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(frame, {
        toValue: FRAMES,
        duration: LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [frame, still]);

  const steps = staircase(size);
  const config = { inputRange: steps.input, extrapolate: "clamp" as const };

  return (
    <View
      style={{ width: size, height: size, overflow: "hidden" }}
      accessibilityRole="image"
      accessibilityLabel="Harina Bakeshoppe"
    >
      <Animated.Image
        source={SHEET}
        /* RN's own Animated.Image, deliberately: driving an Animated-wrapped
           expo-image is what took down the Android render thread in the hero
           carousel. */
        style={{
          width: size * COLS,
          height: size * ROWS,
          transform: [
            { translateX: frame.interpolate({ ...config, outputRange: steps.x }) },
            { translateY: frame.interpolate({ ...config, outputRange: steps.y }) },
          ],
        }}
        resizeMode="stretch"
      />
    </View>
  );
}
