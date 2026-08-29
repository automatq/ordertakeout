import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";

import { useTheme } from "../theme";

const NOTCH = 22;
const DASH = 7;

/**
 * The tear line across the pickup pass.
 *
 * The notches are full circles in the canvas colour, centred on the point where
 * the tear line meets each edge, so the card's own `overflow: hidden` crops each
 * one to the half-bite that reads as a ticket perforation. They are drawn rather
 * than clipped because React Native has no way to subtract one shape from
 * another.
 */
export function Perforation() {
  const { c } = useTheme();
  const [width, setWidth] = useState(0);
  /* Same guard as the slider: an unconditional setState here loops on Android,
     where layout widths can alternate by a fraction of a pixel. */
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  };

  /* `repeating-linear-gradient(90deg, … 0 7px, transparent 7px 14px)` in the
     design — 7 on, 7 off, starting at the left edge. Counting the dashes gives
     that exactly; a dashed border would let the platform pick the rhythm. */
  const dashes = Math.max(0, Math.ceil((width + DASH) / (DASH * 2)));

  return (
    <View style={{ height: NOTCH, backgroundColor: c.surface }}>
      {(["left", "right"] as const).map((side) => (
        <View
          key={side}
          style={{
            position: "absolute",
            top: -NOTCH / 2,
            [side]: -NOTCH / 2,
            width: NOTCH,
            height: NOTCH,
            borderRadius: 999,
            backgroundColor: c.canvas,
          }}
        />
      ))}
      <View
        onLayout={onLayout}
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          height: 1,
          flexDirection: "row",
          overflow: "hidden",
        }}
      >
        {Array.from({ length: dashes }, (_, index) => (
          <View
            key={index}
            style={{ width: DASH, height: 1, marginRight: DASH, backgroundColor: c.borderStrong }}
          />
        ))}
      </View>
    </View>
  );
}
