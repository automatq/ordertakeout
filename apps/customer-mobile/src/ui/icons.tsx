import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { useColors } from "../theme";

/**
 * The design's icon set, as path data.
 *
 * Stroked, 24×24, 1.75 weight — lifted verbatim from Harina App.dc.html so the
 * app and the prototype draw the same shapes. Geometry travels between web and
 * native; JSX does not, which is why these are strings rather than components
 * copied from the storefront.
 */
export const paths = {
  pin: ["M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z"],
  bell: ["M6 9a6 6 0 0 1 12 0c0 4 1.5 5 1.5 5h-15S6 13 6 9Z", "M10.5 18a1.5 1.5 0 0 0 3 0"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronRight: ["m9 6 6 6-6 6"],
  arrowRight: ["M5 12h14", "m13 6 6 6-6 6"],
  arrowLeft: ["M19 12H5", "m11 18-6-6 6-6"],
  search: ["m20 20-4.5-4.5"],
  minus: ["M5 12h14"],
  plus: ["M12 5v14", "M5 12h14"],
  check: ["m5 13 4 4L19 7"],
  calendar: ["M4 10h16M9 3v4M15 3v4"],
  close: ["M6 6l12 12M18 6 6 18"],
  info: ["M12 8v5M12 16h.01"],
  lock: ["M8 10V7a4 4 0 0 1 8 0v3"],
  clock: ["M12 7v5l3 2"],
  bag: ["M6 8h12l-1 12H7L6 8Z", "M9 8V6a3 3 0 0 1 6 0v2"],
  home: [
    "M4 14a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3Z",
    "M8.5 9c.5-1.5 1.5-2.5 3.5-2.5S15 7.5 15.5 9",
    "M9 13.5h.01M12 13.5h.01M15 13.5h.01",
  ],
  list: ["M4 7h16M4 12h16M4 17h16"],
  person: ["M5 20a7 7 0 0 1 14 0"],
  card: ["M3 10h18"],
  phone: ["M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z"],
  trash: ["M4 7h16", "M9 7V5h6v2", "M6 7l1 13h10l1-13"],
} as const;

/** Extra primitives some icons need beyond a path. */
const circles: Partial<Record<keyof typeof paths, { cx: number; cy: number; r: number }[]>> = {
  pin: [{ cx: 12, cy: 10, r: 2.5 }],
  search: [{ cx: 11, cy: 11, r: 6 }],
  clock: [{ cx: 12, cy: 12, r: 9 }],
  info: [{ cx: 12, cy: 12, r: 9 }],
  person: [{ cx: 12, cy: 8, r: 3.5 }],
};

/**
 * Icons whose outline is a rounded rectangle.
 *
 * Kept apart from the paths for the same reason as the circles: the design
 * draws these with an SVG primitive, and hand-converting a `rect` into a path
 * is where a 2px corner radius quietly becomes a square one.
 */
const rects: Partial<
  Record<keyof typeof paths, { x: number; y: number; width: number; height: number; rx: number }[]>
> = {
  calendar: [{ x: 4, y: 5, width: 16, height: 16, rx: 2 }],
  lock: [{ x: 5, y: 10, width: 14, height: 10, rx: 2 }],
};

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 20,
  color,
  strokeWidth = 1.75,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const c = useColors();
  const stroke = color ?? c.inkMuted;

  return (
    <Svg viewBox="0 0 24 24" width={size} height={size} fill="none">
      {(rects[name] ?? []).map((rect, i) => (
        <Rect
          key={`r${i}`}
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={rect.rx}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      ))}
      {(circles[name] ?? []).map((circle, i) => (
        <Circle
          key={`c${i}`}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.r}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      ))}
      {paths[name].map((d, i) => (
        <Path
          key={i}
          d={d}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

/** A tinted disc with an icon in it — the design uses these throughout. */
export function IconBubble({
  name,
  tint,
  background,
  size = 34,
  icon,
}: {
  name: IconName;
  tint: string;
  background: string;
  size?: number;
  icon?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        backgroundColor: background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={name} size={icon ?? Math.round(size * 0.5)} color={tint} />
    </View>
  );
}
