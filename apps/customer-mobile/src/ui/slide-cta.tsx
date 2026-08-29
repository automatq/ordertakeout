import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as haptics from "../haptics";
import { shadows, useTheme } from "../theme";
import { CTA_BUTTON, StickyCta } from "./chrome";
import { Glass } from "./glass";
import { Icon, type IconName } from "./icons";
import {
  DIRECTION_SLOP,
  nextArmed,
  shouldCommit,
  slideFraction,
  travelFor,
} from "./slide-math";
import { CHROME_MAX_SCALE, Label } from "./text";

/**
 * The sticky bar you slide rather than tap.
 *
 * The last two steps of the order path use it — leaving the time you have picked
 * and paying for what is in the bag. A gesture you have to mean is the right
 * shape for both, the same reason a phone asks you to slide to power off, and
 * it is also a single edge-to-edge touch target: the whole track responds,
 * because everything drawn on it is `pointerEvents="none"`. The earlier steps
 * stay taps — adding a tray is not a commitment worth two hands.
 *
 * Built on React Native's own `Animated` and `PanResponder`. Reanimated and
 * gesture-handler are both unavailable here — see the note in App.tsx — and
 * gesture-handler would in any case need a root view wrapping all eleven
 * screens to ship one control.
 */

/** Gap between the track edge and the thumb. */
const INSET = 4;
/** 48pt, comfortably past the 44pt minimum target. */
const THUMB = CTA_BUTTON - INSET * 2;
const TRACK_RADIUS = 18;
/** How long the thumb takes to finish the journey once you have let go. */
const SETTLE_MS = 130;
/** Travel that makes a drag on a blocked bar an attempt rather than a brush. */
const BLOCKED_SLOP = 12;

export function SlideCta({
  label,
  tapLabel,
  value,
  onConfirm,
  blockedReason,
  blockedIcon = "lock",
  busy,
}: {
  /** What the bar says while it can be slid. */
  label: string;
  /** What the same action is called when it is offered as a plain button. */
  tapLabel: string;
  /** Money, when the step is about money. Empty on the steps that are not. */
  value?: string;
  /** Undefined means there is nothing to run yet. */
  onConfirm?: () => void;
  /** Why the step cannot run yet, or null once it can. */
  blockedReason: string | null;
  /** What the thumb shows while blocked. A lock, unless the block is a missing answer. */
  blockedIcon?: IconName;
  busy?: boolean;
}) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const sh = shadows(scheme);

  const [width, setWidth] = useState(0);
  const [reader, setReader] = useState(false);

  /* Pixels of thumb travel, 0..travel. Native-driven throughout: a node has one
     driver for its whole life, and mixing in a JS-driven animation later throws.
     Everything it touches is a transform or an opacity, never a width. */
  const pan = useRef(new Animated.Value(0)).current;
  const grab = useRef(new Animated.Value(0)).current;

  const armed = useRef(false);
  const locked = useRef(false);
  const refused = useRef(false);
  const mounted = useRef(true);
  const still = useRef(false);

  const travel = travelFor(width, INSET, THUMB);
  const blocked = blockedReason != null;
  const active = !!onConfirm && !blocked && !busy;

  /* The responder is built once and reads the moving parts from refs. Rebuilding
     it when a prop changes would swap the handlers mid-drag, and the replacement
     starts with a fresh gestureState whose dx is back at zero. */
  const travelRef = useRef(travel);
  const activeRef = useRef(active);
  const reasonRef = useRef(blockedReason);
  const confirmRef = useRef(onConfirm);
  travelRef.current = travel;
  activeRef.current = active;
  reasonRef.current = blockedReason;
  confirmRef.current = onConfirm;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pan.stopAnimation();
      grab.stopAnimation();
    };
  }, [grab, pan]);

  useEffect(() => {
    let alive = true;
    const read = () =>
      Promise.all([
        AccessibilityInfo.isReduceMotionEnabled(),
        AccessibilityInfo.isScreenReaderEnabled(),
      ]).then(([motion, screenReader]) => {
        if (!alive) return;
        /* In a ref as well, because the release handler needs the current
           setting and it runs from a closure the re-render never reaches. */
        still.current = motion;
        setReader(screenReader);
      });
    void read();
    const subs = [
      AccessibilityInfo.addEventListener("reduceMotionChanged", () => void read()),
      AccessibilityInfo.addEventListener("screenReaderChanged", () => void read()),
    ];
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  const release = useCallback(
    (commit: boolean) => {
      armed.current = false;
      if (still.current) grab.setValue(0);
      else Animated.spring(grab, { toValue: 0, useNativeDriver: true }).start();

      const distance = travelRef.current;
      if (!activeRef.current) return;

      if (!commit) {
        /* Reduce Motion keeps the outcome and drops the travel — the thumb is
           back at the start either way, it just does not fly there. */
        if (still.current) pan.setValue(0);
        else
          Animated.spring(pan, {
            toValue: 0,
            stiffness: 220,
            damping: 26,
            mass: 1,
            restDisplacementThreshold: 0.5,
            useNativeDriver: true,
          }).start();
        return;
      }

      if (still.current) {
        pan.setValue(distance);
        confirmRef.current?.();
        return;
      }

      /* Run the thumb the rest of the way before paying, so the control never
         looks like it charged you from the middle of the track. Locked while it
         does, which is what lets every drag start from a pan of zero and lets
         the decisions above read gestureState instead of this value. */
      locked.current = true;
      Animated.timing(pan, {
        toValue: distance,
        duration: SETTLE_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(({ finished }) => {
        locked.current = false;
        /* A settle that lands after the screen has moved on would otherwise
           navigate from a component nobody is looking at. */
        if (finished && mounted.current) confirmRef.current?.();
      });
    },
    [grab, pan],
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        /* Claimed on movement and only sideways, so a tap or a vertical swipe on
           the bar is never captured. Nothing scrollable sits under it today —
           the bar is a sibling of the screen, not a child of its ScrollView —
           but this is what keeps that true if it ever moves inside one. */
        onMoveShouldSetPanResponder: (_event, g) => {
          if (locked.current) return false;
          if (reasonRef.current == null && travelRef.current <= 0) return false;
          return Math.abs(g.dx) > DIRECTION_SLOP && Math.abs(g.dx) > Math.abs(g.dy);
        },
        onPanResponderGrant: () => {
          armed.current = false;
          refused.current = false;
          if (!activeRef.current) return;
          haptics.select();
          if (!still.current) Animated.spring(grab, { toValue: 1, useNativeDriver: true }).start();
        },
        onPanResponderMove: (_event, g) => {
          if (!activeRef.current) {
            const reason = reasonRef.current;
            /* Not a violation of "inert controls stay silent": something did
               happen, and the answer is on screen in the card above. Once per
               gesture, and only past a distance no accidental brush covers. */
            if (reason && !refused.current && g.dx > BLOCKED_SLOP) {
              refused.current = true;
              haptics.error();
              AccessibilityInfo.announceForAccessibility(reason);
            }
            return;
          }
          const distance = travelRef.current;
          /* setValue on a native node forwards straight to the native animated
             graph, so the thumb tracks the finger without a React render.
             Animated.event cannot do this job: a native one only notifies
             listeners and never writes the value, because it expects a view tag
             a PanResponder callback does not have. */
          pan.setValue(Math.min(distance, Math.max(0, g.dx)));

          const next = nextArmed(slideFraction(g.dx, distance), armed.current);
          /* On the crossing only. Without the disarm band below the threshold a
             finger resting on the line buzzes over and over — the 30ms coalescer
             in haptics.ts is far too short to catch wobbles that slow. */
          if (next && !armed.current) haptics.commit();
          armed.current = next;
        },
        onPanResponderRelease: (_event, g) => {
          release(shouldCommit(slideFraction(g.dx, travelRef.current), g.vx));
        },
        /* An incoming call, or Android's own back gesture, ends up here. */
        onPanResponderTerminate: () => release(false),
        onPanResponderTerminationRequest: () => !armed.current,
      }),
    [grab, pan, release],
  );

  /* Guarded, and it is not paranoia: Android reports sub-pixel widths that can
     alternate between two neighbouring values, so setting state unconditionally
     here is a re-layout loop that pins a core at 100% and ends in an ANR. */
  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  };

  if (reader) {
    /* The same button every other step of the path ends in, rather than a second
       implementation of one. Telling somebody on VoiceOver to slide would be a
       lie, so this branch says what the action is instead of how it is made. */
    return (
      <StickyCta
        label={tapLabel}
        value={blocked ? undefined : value || undefined}
        onPress={onConfirm}
        disabled={!active}
        busy={busy}
      />
    );
  }

  const ready = travel > 0;
  /* An interpolation whose input range has collapsed throws, and before the
     first onLayout that is exactly what these would be. */
  const thumbShift = ready
    ? pan.interpolate({ inputRange: [0, travel], outputRange: [0, travel], extrapolate: "clamp" })
    : 0;
  const thumbScale = grab.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  /* Only while it can be slid. A control that has just been used — the thumb
     parked at the far end, the step now working or refusing — still has
     something to say, and fading its label out would leave an empty red bar. */
  const captionFade =
    ready && active
      ? pan.interpolate({
          inputRange: [0, travel * 0.55],
          outputRange: [1, 0],
          extrapolate: "clamp",
        })
      : 1;

  /* The fill has to reach the thumb's trailing edge without anything animating a
     width, so it is a full-track rectangle scaled about its left edge. That is
     the translate-then-scale pair rather than transformOrigin: it is arithmetic
     no animation driver can reinterpret, and this one runs natively. */
  const filled = (at: number) => INSET + THUMB + at;
  const fillScale = ready
    ? pan.interpolate({
        inputRange: [0, travel],
        outputRange: [filled(0) / width, filled(travel) / width],
        extrapolate: "clamp",
      })
    : 1;
  const fillShift = ready
    ? pan.interpolate({
        inputRange: [0, travel],
        outputRange: [(filled(0) - width) / 2, (filled(travel) - width) / 2],
        extrapolate: "clamp",
      })
    : 0;

  return (
    <Glass
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingTop: 14,
        paddingHorizontal: 20,
        paddingBottom: Math.max(insets.bottom, 14),
      }}
      solid={{ backgroundColor: c.canvas, borderTopWidth: 1, borderTopColor: c.border }}
    >
      {/* The shadow sits out here and not on the track: `overflow: hidden`
          is `masksToBounds` on iOS, which clips a layer's own shadow away
          along with its children. */}
      <View style={[{ borderRadius: TRACK_RADIUS }, active && sh.brand]}>
        <View
          {...responder.panHandlers}
          onLayout={onLayout}
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            blockedReason ? `${label}. ${blockedReason}` : value ? `${label}, ${value}` : label
          }
          accessibilityState={{ disabled: !active }}
          /* Switch Control and Android Switch Access drive this branch without
             setting the screen-reader flag, so activation must not be a dead end. */
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={() => onConfirm?.()}
          style={[
            {
              height: CTA_BUTTON,
              borderRadius: TRACK_RADIUS,
              backgroundColor: c.brand,
              overflow: "hidden",
              justifyContent: "center",
            },
            !active && { opacity: 0.45 },
          ]}
        >
          {ready && active ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width,
                /* White over brand, never brandDeep: that token is darker than
                   brand in light mode and lighter in dark, so it would swap which
                   side of the fill reads as filled between schemes. */
                backgroundColor: "rgba(255, 255, 255, 0.16)",
                transform: [{ translateX: fillShift }, { scaleX: fillScale }],
              }}
            />
          ) : null}

          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: INSET * 2 + THUMB,
              right: 16,
              top: 0,
              bottom: 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 9,
              opacity: captionFade,
            }}
          >
            <Label size={15.5} color={c.brandInk} numberOfLines={1} maxScale={CHROME_MAX_SCALE}>
              {label}
            </Label>
            {value && !blocked ? (
              <Label
                size={15.5}
                color={c.brandInk}
                maxScale={CHROME_MAX_SCALE}
                style={{ fontVariant: ["tabular-nums"] }}
              >
                {value}
              </Label>
            ) : null}
            {/* The affordance, and the whole of it. A looping shimmer on the bar
                that takes someone's money is motion nobody asked for. */}
            {active ? (
              <View style={{ flexDirection: "row", marginLeft: -3 }}>
                {[0.28, 0.5, 0.85].map((opacity) => (
                  <View key={opacity} style={{ opacity, marginLeft: -5 }}>
                    <Icon name="chevronRight" size={16} color={c.brandInk} strokeWidth={2.2} />
                  </View>
                ))}
              </View>
            ) : null}
          </Animated.View>

          {/* Absolute rather than laid out in a row: flexDirection flips under RTL
              and translateX does not, so a future mirrored build is a sign change
              here and a flipped arrow, not a rebuild. No shadow — the track clips
              its children, and a clipped shadow is a smudge. */}
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: INSET,
              top: INSET,
              width: THUMB,
              height: THUMB,
              borderRadius: TRACK_RADIUS - INSET,
              backgroundColor: c.brandInk,
              alignItems: "center",
              justifyContent: "center",
              transform: [{ translateX: thumbShift }, { scaleX: thumbScale }, { scaleY: thumbScale }],
            }}
          >
            <Icon
              name={blocked ? blockedIcon : "arrowRight"}
              size={20}
              color={c.brand}
              strokeWidth={2}
            />
          </Animated.View>
        </View>
      </View>
    </Glass>
  );
}

/* Deliberately not here: haptics.success. This control only knows that somebody
   asked for the next thing, and success means the order is in — it belongs
   wherever the placed order comes back. */
