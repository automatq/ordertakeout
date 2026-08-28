import { PixelRatio, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as haptics from "../haptics";
import { radius, shadows, useTheme } from "../theme";
import { Glass } from "./glass";
import { Icon, type IconName } from "./icons";
import { Body, CHROME_MAX_SCALE, Label } from "./text";

/**
 * The furniture that sits outside a screen: the tab bar, the sticky call to
 * action, and the toast.
 *
 * All three hug the bottom edge, so all three need the home-indicator inset.
 * Getting that from the device rather than a hardcoded 34pt is what keeps them
 * off the indicator on a modern iPhone and flush to the edge on an older one.
 */

export interface Tab {
  key: string;
  label: string;
  icon: IconName;
}

export const TABS: Tab[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "menu", label: "Trays", icon: "list" },
  { key: "track", label: "Track", icon: "clock" },
  { key: "account", label: "Account", icon: "person" },
];

/**
 * How much room a scrolling screen must leave for the floating chrome.
 *
 * Derived from the bar's own padding and type rather than measured, because the
 * screens need the number while laying out — before the bar has reported a
 * height. Which is exactly why the labels below are capped: an uncapped label
 * would grow past what is reserved here and hide the content underneath it.
 */
const TAB_ICON = 23;
const TAB_LABEL_SIZE = 10.5;
const CTA_BUTTON = 56;

const chromeScale = () => Math.min(PixelRatio.getFontScale(), CHROME_MAX_SCALE);

/** Bottom padding a scrolling screen needs to clear the floating tab bar. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  const label = TAB_LABEL_SIZE * 1.55 * chromeScale();
  return 9 + TAB_ICON + 4 + label + Math.max(insets.bottom, 10);
}

/** The same, for the screens that end in a sticky call to action. */
export function useCtaSpace(): number {
  const insets = useSafeAreaInsets();
  return 14 + CTA_BUTTON + Math.max(insets.bottom, 14);
}

export function TabBar({
  current,
  onSelect,
  cartCount,
  onCart,
}: {
  current: string;
  onSelect: (key: string) => void;
  cartCount: number;
  onCart: () => void;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    /* Floating rather than in flow: the glass has nothing to refract unless the
       screen's content passes beneath it. Screens make room with
       useTabBarSpace() instead of being shortened. */
    <Glass
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        alignItems: "flex-start",
        paddingTop: 9,
        paddingHorizontal: 10,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
      solid={{ backgroundColor: c.canvas, borderTopWidth: 1, borderTopColor: c.border }}
    >
      {TABS.map((tab) => {
        const on = current === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onSelect(tab.key)}
            onPressIn={haptics.select}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 7 }}
          >
            <Icon name={tab.icon} size={TAB_ICON} color={on ? c.brand : c.inkSubtle} />
            <Body size={TAB_LABEL_SIZE} color={on ? c.brand : c.inkSubtle} maxScale={CHROME_MAX_SCALE}>
              {tab.label}
            </Body>
          </Pressable>
        );
      })}

      <Pressable
        onPress={onCart}
        onPressIn={haptics.select}
        accessibilityRole="tab"
        accessibilityLabel={`Order, ${cartCount} item${cartCount === 1 ? "" : "s"}`}
        style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 7 }}
      >
        <Icon name="bag" size={TAB_ICON} color={c.inkSubtle} />
        <Body size={TAB_LABEL_SIZE} color={c.inkSubtle} maxScale={CHROME_MAX_SCALE}>
          Order
        </Body>
        {cartCount > 0 ? (
          <View
            style={{
              position: "absolute",
              top: 2,
              right: "50%",
              marginRight: -30,
              minWidth: 19,
              height: 19,
              paddingHorizontal: 5,
              borderRadius: 999,
              backgroundColor: c.brand,
              borderWidth: 2,
              borderColor: c.canvas,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Label size={10.5} color={c.brandInk}>
              {String(cartCount)}
            </Label>
          </View>
        ) : null}
      </Pressable>
    </Glass>
  );
}

/**
 * The bar that carries the one thing this screen is for.
 *
 * It stays put while the content scrolls, because on the ordering path the next
 * step should never be something you have to go looking for.
 */
export function StickyCta({
  label,
  value,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const sh = shadows(scheme);
  const inactive = disabled || busy;

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
      <Pressable
        onPress={onPress}
        onPressIn={onPress && haptics.commit}
        disabled={inactive}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={({ pressed }) => [
          {
            minHeight: CTA_BUTTON,
            paddingHorizontal: 22,
            borderRadius: 18,
            borderWidth: 2,
            borderColor: c.brand,
            backgroundColor: c.brand,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          },
          !inactive && sh.brand,
          inactive && { opacity: 0.45 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Label size={15.5} color={c.brandInk}>
          {label}
        </Label>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
          {value ? (
            <Label size={15.5} color={c.brandInk} style={{ fontVariant: ["tabular-nums"] }}>
              {value}
            </Label>
          ) : null}
          <Icon name="arrowRight" size={18} color={c.brandInk} strokeWidth={1.9} />
        </View>
      </Pressable>
    </Glass>
  );
}

/** Brief confirmation that something went in the order, with a way to see it. */
export function Toast({ message, onView }: { message: string; onView: () => void }) {
  const { c, scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const sh = shadows(scheme);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: Math.max(insets.bottom, 12) + 92,
      }}
    >
      <View
        style={[
          {
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
            padding: 13,
            borderRadius: 18,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
            borderLeftWidth: 4,
            borderLeftColor: c.secondary,
          },
          sh.raised,
        ]}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            backgroundColor: c.secondarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="check" size={15} color={c.secondary} strokeWidth={2.2} />
        </View>
        <Body size={13.5} color={c.ink} style={{ flex: 1 }} numberOfLines={2}>
          {message}
        </Body>
        <Pressable onPress={onView} onPressIn={haptics.tap} hitSlop={8}>
          <Label size={13} color={c.brand}>
            View
          </Label>
        </Pressable>
      </View>
    </View>
  );
}

/** A sheet-style panel with the design's larger corner radius. */
export function Sheet({ children }: { children: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: radius.sheet,
        borderWidth: 1,
        borderColor: c.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}
