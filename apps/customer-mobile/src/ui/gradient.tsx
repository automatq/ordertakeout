import { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * The brand wash behind the hero.
 *
 * The stops are literal hexes rather than palette tokens, matching the design:
 * the hero keeps the same warm ramp in both themes. Driving it from tokens
 * would invert it in dark mode, where `brandDeep` is the *lightest* red in the
 * ramp, and the wash would brighten towards its edges.
 *
 * CSS spells this `radial-gradient(circle at 26% 42%, …)`, whose default extent
 * is farthest-corner — the circle reaches the corner furthest from its centre.
 * SVG has no such keyword, so the radius is derived from the measured box. A
 * percentage radius is not equivalent: it resolves against a normalised
 * diagonal, which turns the circle into an ellipse on any non-square band.
 */
export function BrandWash({
  cx = 0.26,
  cy = 0.42,
  mid = 0.58,
}: {
  cx?: number;
  cy?: number;
  mid?: number;
}) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height },
    );
  };

  const radius = Math.hypot(
    Math.max(cx, 1 - cx) * box.width,
    Math.max(cy, 1 - cy) * box.height,
  );

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {/* Painted flat first so the band is never briefly transparent on the
          frame before onLayout reports a box to size the circle against. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: "#ce3f23" }]} />
      {radius > 0 ? (
        <Svg width={box.width} height={box.height}>
          <Defs>
            <RadialGradient
              id="brandWash"
              gradientUnits="userSpaceOnUse"
              cx={cx * box.width}
              cy={cy * box.height}
              r={radius}
            >
              <Stop offset="0" stopColor="#f44a35" />
              <Stop offset={String(mid)} stopColor="#ce3f23" />
              <Stop offset="1" stopColor="#a8321c" />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={box.width} height={box.height} fill="url(#brandWash)" />
        </Svg>
      ) : null}
    </View>
  );
}
