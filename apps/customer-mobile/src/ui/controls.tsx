import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import * as haptics from "../haptics";
import { font, radius, shadows, TRACKING, useColors, useTheme } from "../theme";
import { Icon, type IconName } from "./icons";
import { Body, Label, Tabular } from "./text";

/**
 * The design's controls.
 *
 * Everything is a pill or a 16pt-radius rectangle, everything has a visible
 * border, and the brand button carries a coloured shadow. Those three rules are
 * most of the design's character, so they live in one place rather than being
 * retyped per screen.
 */

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  busy,
  trailing,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  busy?: boolean;
  /** Right-aligned value, as on the sticky cart button. */
  trailing?: string;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);
  const inactive = disabled || busy;

  const palette = {
    primary: { bg: c.brand, border: c.brand, fg: c.brandInk, shadow: sh.brand },
    secondary: { bg: c.surface, border: c.borderStrong, fg: c.ink, shadow: undefined },
    ghost: { bg: "transparent", border: "transparent", fg: c.brand, shadow: undefined },
    /* Outlined rather than filled, at the design's 35% border. Cancelling an
       order is destructive but it is also the customer's own to make, and a
       solid red button reads as the thing the screen wants you to press. */
    danger: { bg: c.surface, border: `${c.danger}59`, fg: c.danger, shadow: undefined },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      /* On press-in, not on release: this is the "the phone felt that" tap, and
         a control that waits for your finger to lift feels a beat behind it.
         Guarded on `onPress` because several of these are deliberately inert —
         buzzing for a button that does nothing is worse than staying silent. */
      onPressIn={onPress && (variant === "primary" ? haptics.commit : haptics.tap)}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          minHeight: 54,
          paddingHorizontal: 22,
          borderRadius: 18,
          borderWidth: 2,
          borderColor: palette.border,
          backgroundColor: palette.bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: trailing ? "space-between" : "center",
          gap: 9,
        },
        variant === "primary" && !inactive ? palette.shadow : null,
        /* Dimmed rather than hidden: a disabled cart button still has to say
           what it would do, so somebody knows what to fix. */
        inactive && { opacity: 0.45 },
        pressed && { opacity: 0.85 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
            {icon ? <Icon name={icon} size={18} color={palette.fg} /> : null}
            <Label size={15.5} color={palette.fg}>
              {label}
            </Label>
          </View>
          {trailing ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
              <Tabular size={15.5} color={palette.fg}>
                {trailing}
              </Tabular>
              <Icon name="arrowRight" size={18} color={palette.fg} strokeWidth={1.9} />
            </View>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/**
 * A filter or time chip.
 *
 * Disabled means "this slot cannot be had" rather than "not yet" — the design
 * strikes it through and gives the reason underneath, so a full 5pm reads
 * differently from one that is merely unselected.
 */
export function Chip({
  label,
  selected,
  disabled,
  onPress,
  note,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  note?: string;
}) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);

  return (
    <Pressable
      onPress={onPress}
      /* Selection, not impact: a size, a date, a time. A disabled Pressable
         fires neither, which is right — a sold-out slot should feel like
         nothing at all. */
      onPressIn={onPress && haptics.select}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        {
          borderRadius: radius.chip,
          borderWidth: 2,
          paddingHorizontal: 16,
          paddingVertical: 9,
          alignItems: "center",
          borderColor: disabled ? c.border : selected ? c.brand : c.borderStrong,
          backgroundColor: disabled ? c.surfaceSunken : selected ? c.brand : c.surface,
        },
        selected && !disabled ? sh.brand : sh.card,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Label
        size={13}
        color={disabled ? c.inkMuted : selected ? c.brandInk : c.ink}
        style={disabled ? { textDecorationLine: "line-through" } : undefined}
      >
        {label}
      </Label>
      {note ? (
        <Body size={10.5} color={disabled ? c.inkSubtle : selected ? c.brandInk : c.inkSubtle}>
          {note}
        </Body>
      ) : null}
    </Pressable>
  );
}

/** A white panel on the cream canvas. The app's basic unit of content. */
export function Card({
  children,
  style,
  padded = true,
  raised,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  raised?: boolean;
}) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);
  return (
    <View
      style={[
        {
          backgroundColor: c.surface,
          borderRadius: radius.card,
          borderWidth: 1,
          borderColor: c.border,
        },
        padded && { padding: 16 },
        raised ? sh.raised : sh.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Status pills, and the accent "order a day ahead" flag on menu photos. */
export function Badge({
  label,
  tint,
  background,
  border,
}: {
  label: string;
  tint: string;
  background: string;
  border?: string;
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        borderRadius: radius.chip,
        paddingHorizontal: 11,
        paddingVertical: 5,
        backgroundColor: background,
        borderWidth: border ? 1 : 0,
        borderColor: border,
      }}
    >
      <Label size={11} color={tint} style={{ fontFamily: font.medium, letterSpacing: TRACKING }}>
        {label}
      </Label>
    </View>
  );
}

/** The round back/search/notification buttons the design floats in headers. */
export function RoundButton({
  icon,
  onPress,
  label,
  overlay,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  /** Sits on a photo rather than the canvas, so it needs its own backing. */
  overlay?: boolean;
}) {
  const { c, scheme } = useTheme();
  const sh = shadows(scheme);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPress && haptics.tap}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        {
          width: 44,
          height: 44,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: overlay ? "rgba(255,255,255,0.92)" : c.surface,
          borderWidth: overlay ? 0 : 1,
          borderColor: c.border,
        },
        !overlay && sh.card,
        pressed && { opacity: 0.85 },
      ]}
    >
      {/* On a photo the icon is always dark, whatever the theme — the backing
          is white in both. */}
      <Icon name={icon} size={19} color={overlay ? "#1a1a1a" : c.ink} />
    </Pressable>
  );
}

/** Quantity stepper: minus, tabular count, plus. */
export function Stepper({
  value,
  onChange,
  min = 1,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
}) {
  const c = useColors();
  const step = (delta: number) => onChange(Math.max(min, value + delta));

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: radius.control,
        backgroundColor: c.surfaceSunken,
      }}
    >
      <Pressable
        onPress={() => step(-1)}
        onPressIn={haptics.select}
        disabled={value <= min}
        accessibilityLabel="Decrease"
        style={({ pressed }) => [
          { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
          value <= min && { opacity: 0.35 },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Icon name="minus" size={18} />
      </Pressable>
      {/* minWidth, not width: the count is content and scales with Dynamic
          Type, and a fixed box clips a two-digit quantity at large sizes. */}
      <Tabular size={16} style={{ minWidth: 40, textAlign: "center" }}>
        {String(value)}
      </Tabular>
      <Pressable
        onPress={() => step(1)}
        onPressIn={haptics.select}
        accessibilityLabel="Increase"
        style={({ pressed }) => [
          { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
          pressed && { opacity: 0.6 },
        ]}
      >
        <Icon name="plus" size={18} />
      </Pressable>
    </View>
  );
}
