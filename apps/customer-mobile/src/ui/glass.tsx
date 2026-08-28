import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView, BlurTargetView } from "expo-blur";

import { useTheme } from "../theme";

/**
 * Whether the person has asked the system to stop making surfaces see-through.
 *
 * Reduce Transparency is an iOS setting; Android has no equivalent, so this is
 * always false there. Subscribed rather than read once because it is a switch
 * people flick mid-task when a screen is hard to read, and the app should follow
 * them there.
 */
function useReduceTransparency(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let active = true;
    void AccessibilityInfo.isReduceTransparencyEnabled().then((on) => {
      if (active) setReduced(on);
    });
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

/**
 * Whether to draw real Liquid Glass rather than a frosted or solid surface.
 *
 * `isLiquidGlassAvailable()` answers "does this OS have the material" — false on
 * Android and on iOS before 26. Reduce Transparency answers "does this person
 * want any of it".
 */
export function useGlass(): boolean {
  const reduced = useReduceTransparency();
  return isLiquidGlassAvailable() && !reduced;
}

/**
 * The view Android's blur samples from.
 *
 * Android cannot blur "whatever happens to be behind this"; it has to be handed
 * the view to sample, or `BlurView` silently falls back to no blur at all —
 * which is how the first cut of this shipped a flat tint that only looked like
 * glass. Screens go inside this; the floating chrome stays outside it, so the
 * chrome blurs the content it sits over.
 */
const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/**
 * Publishes the target ref. This has to sit ABOVE the floating chrome, not
 * around the content: the tab bar and the sticky CTA are siblings of the
 * scrolling area, so a provider wrapped only around the content is invisible to
 * exactly the views that need to blur it.
 */
export function BlurTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View | null>(null);
  /* One re-render after mount: the ref is still null while children first
     render, and a BlurView handed a null target never attaches to anything. */
  const [, settle] = useReducer((n: number) => n + 1, 0);
  useEffect(() => settle(), []);

  return <BlurTargetContext.Provider value={ref}>{children}</BlurTargetContext.Provider>;
}

/** The sampled surface itself — screens go in here. */
export function BlurTargetSurface({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const ref = useContext(BlurTargetContext);
  return (
    <BlurTargetView ref={ref ?? undefined} style={style}>
      {children}
    </BlurTargetView>
  );
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * A floating surface with three renderings, richest first:
 *
 *  1. iOS 26+ — real Liquid Glass, which refracts the content beneath it.
 *  2. Everywhere else — a frosted `BlurView` sampling the nearest `BlurTarget`.
 *  3. Reduce Transparency on — the opaque `solid` card, honouring the setting.
 *
 * `style` is geometry, applied in every mode. `solid` carries the colour, border
 * and shadow of the opaque fallback; its border is reused for the frosted mode
 * (with the fill dropped, since the blur is the fill) so a bar keeps its
 * hairline edge on every platform.
 */
export function Glass({
  children,
  style,
  solid,
  tint,
  glassStyle = "regular",
  interactive,
  onLayout,
}: {
  children?: ReactNode;
  /** Geometry and spacing — applied in every mode. */
  style?: StyleProp<ViewStyle>;
  /** Colour, border and shadow used when glass is unavailable. */
  solid?: StyleProp<ViewStyle>;
  tint?: string;
  glassStyle?: "regular" | "clear";
  interactive?: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
}) {
  const { scheme, c } = useTheme();
  const reduced = useReduceTransparency();
  const target = useContext(BlurTargetContext);
  const clear = glassStyle === "clear";

  // 1. Real Liquid Glass.
  if (isLiquidGlassAvailable() && !reduced) {
    return (
      <GlassView
        style={style}
        glassEffectStyle={glassStyle}
        tintColor={tint}
        isInteractive={interactive}
        onLayout={onLayout}
      >
        {children}
      </GlassView>
    );
  }

  // 3. Reduce Transparency — the opaque card.
  if (reduced) {
    return (
      <View style={[style, solid]} onLayout={onLayout}>
        {children}
      </View>
    );
  }

  // 2. Frosted glass. Keep the fallback's border but drop its opaque fill.
  const { backgroundColor: _fill, ...frame } = StyleSheet.flatten(solid) ?? {};
  /* Light where the blur already carries the surface, heavier when there is no
     target to sample and the tint is doing all the work by itself. */
  const blurring = Platform.OS !== "android" || target?.current != null;
  const wash = blurring ? (scheme === "dark" ? 0.22 : 0.26) : scheme === "dark" ? 0.4 : 0.46;
  const overlay = clear ? `rgba(18, 14, 10, ${blurring ? 0.14 : 0.22})` : hexToRgba(c.canvas, wash);

  return (
    <BlurView
      intensity={clear ? 32 : 56}
      tint={scheme === "dark" ? "dark" : "light"}
      blurMethod="dimezisBlurViewSdk31Plus"
      blurTarget={target ?? undefined}
      style={[style, frame]}
      onLayout={onLayout}
    >
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: overlay }]} />
      {children}
    </BlurView>
  );
}
