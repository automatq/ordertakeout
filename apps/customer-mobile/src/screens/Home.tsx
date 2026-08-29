import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { fromPrice, type MenuProduct, type PickupShop } from "../api";
import { Image as ExpoImage } from "expo-image";

import { formatDate, formatTime } from "../format";
import * as haptics from "../haptics";
import { statusFor } from "../status";
import { radius, shadows, useTheme } from "../theme";
import { Card } from "../ui/controls";
import { Glass } from "../ui/glass";
import { BrandWash } from "../ui/gradient";
import { photoDefaults, Photo } from "../ui/photo";
import { Icon } from "../ui/icons";
import { CardSkeleton } from "../ui/skeleton";
import { MotionSlider, type Slide } from "../ui/slider";
import { useTabBarSpace } from "../ui/chrome";
import { Body, Display, displayScale, Label, Overline } from "../ui/text";
import { compactDisplayLinePull } from "../ui/typography";
import { useTrackedOrder } from "../useTrackedOrder";

const HERO = require("../../assets/hero.webp");
/* Both from the design. The height matters beyond taste: hero.webp fades to a
   flat cream over its bottom ~26 rows, and it is this frame's aspect ratio that
   crops that fade away under `cover`. A taller frame puts it back on screen. */
const HERO_HEIGHT = 186;
const HERO_SIZE = 56;
/* The design sets the headline's line-height to .88. Applying that as an RN
   `lineHeight` clips the caps off Bebas top and bottom — RN crops glyphs to the
   line box where CSS lets them overflow it. So the two lines use the shared,
   safe leading and the second is pulled up by the difference, which lands the
   baselines where the design puts them without cropping anything.
   Computed at render, not once at module load: under Dynamic Type the glyphs
   grow and a pull derived from the literal 56 would leave the two lines
   overlapping. */
const heroLinePull = () => compactDisplayLinePull(HERO_SIZE, displayScale(), 0.88);

/**
 * The returning customer's home.
 *
 * Deliberately not a port of the web homepage — that is 634 lines written to
 * convince a stranger the bakery is worth trying, and somebody who installed the
 * app is past that argument. This answers three questions instead: where am I
 * collecting from, what is there, and how far ahead do I need to order.
 */
export function Home({
  shop,
  products,
  categories,
  loading,
  orderNumber,
  accessKey,
  onChangeShop,
  onOpenProduct,
  onOpenCategory,
  onSeeAll,
  onTrack,
}: {
  shop: PickupShop | null;
  products: MenuProduct[];
  categories: string[];
  /** The menu has not arrived yet — and has not failed either. */
  loading: boolean;
  orderNumber: string | null;
  accessKey: string | null;
  onChangeShop: () => void;
  onOpenProduct: (product: MenuProduct) => void;
  onOpenCategory: (category: string) => void;
  onSeeAll: () => void;
  onTrack: () => void;
}) {
  const { c, scheme } = useTheme();
  const chrome = useTabBarSpace();
  const sh = shadows(scheme);
  const { order, today } = useTrackedOrder(orderNumber, accessKey);
  const [headerHeight, setHeaderHeight] = useState(68);

  /* Only while there is something to wait for. A collected or cancelled order
     on the home screen is clutter reporting old news. */
  const live = order && order.status !== "completed" && order.status !== "canceled" ? order : null;

  const slides = useMemo<Slide[]>(() => {
    const featured = products
      .filter((product) => product.imageUrl)
      .slice(0, 4)
      .map<Slide>((product) => ({
        key: product.id,
        image: { uri: product.imageUrl! },
        badge:
          product.leadTimeDays > 0
            ? `Order ${product.leadTimeDays} day${product.leadTimeDays === 1 ? "" : "s"} ahead`
            : "Order today",
        title: product.name,
        caption: fromPrice(product) ? `From ${fromPrice(product)}` : undefined,
        onPress: () => onOpenProduct(product),
      }));
    return [
      {
        key: "hero",
        image: HERO,
        badge: "Freshly baked daily",
        title: "Baked to order",
        caption: "Pick a date, a time, and a branch.",
        onPress: onSeeAll,
      },
      ...featured,
    ];
  }, [products, onOpenProduct, onSeeAll]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 30 + chrome }}>


      {/* Hero, straight from the design: the headline sits on the brand wash and
          the photo is a separate raised frame overlapping it. This was one
          full-bleed image under a dark scrim, which put the washed-out bottom
          edge baked into hero.webp on screen as a grey band — the design's
          proportions crop that edge off instead. */}
      <View>
        <View
          style={{
            paddingTop: 26 + headerHeight,
            paddingHorizontal: 22,
            paddingBottom: 118,
            borderBottomLeftRadius: 34,
            borderBottomRightRadius: 34,
            overflow: "hidden",
          }}
        >
          <BrandWash />
          <View
            style={{
              alignSelf: "flex-start",
              minHeight: 30,
              justifyContent: "center",
              paddingHorizontal: 13,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.42)",
              backgroundColor: "rgba(168,50,28,0.24)",
            }}
          >
            <Overline size={10} color="#ffffff">
              Freshly baked daily
            </Overline>
          </View>
          <Display size={HERO_SIZE} color="#ffffff" style={{ marginTop: 14 }}>
            Order ahead,
          </Display>
          <Display size={HERO_SIZE} color={c.accent} style={{ marginTop: heroLinePull() }}>
            pick up fresh
          </Display>
          <Body size={14.5} color="rgba(255,255,255,0.9)" style={{ marginTop: 14, maxWidth: 270 }}>
            Party trays baked to order at your branch. Choose a date and time, pay in the app,
            collect at the counter.
          </Body>
          <Pressable
            onPress={onSeeAll}
            onPressIn={haptics.commit}
            accessibilityRole="button"
            style={({ pressed }) => [
              {
                flexDirection: "row",
                alignItems: "center",
                alignSelf: "flex-start",
                gap: 9,
                marginTop: 20,
                minHeight: 50,
                paddingHorizontal: 22,
                borderRadius: 999,
                backgroundColor: "#ffffff",
              },
              pressed && { opacity: 0.9 },
            ]}
          >
            {/* Fixed brand hexes, not palette tokens, because the button is a
                fixed white on the fixed wash. `brandDeep` inverts to a pale
                salmon in dark mode and would be unreadable here. */}
            <Label size={15} color="#a8321c">
              Start your order
            </Label>
            <Icon name="arrowRight" size={17} color="#a8321c" />
          </Pressable>
        </View>

        {/* Pulled up over the wash. The 7pt surface-coloured border is the mat
            the design frames the photo in. No `overflow: hidden` — the image
            carries its own radius, and clipping here would eat the shadow. */}
        <View style={{ marginTop: -100, marginHorizontal: 18 }}>
          {/* The design's mat, now holding a carousel instead of one photo. The
              overflow clip is what gives the slides the 23pt inner radius —
              they are plain rectangles inside it. */}
          <View
            style={[
              {
                borderWidth: 7,
                borderColor: c.surface,
                borderRadius: 30,
                backgroundColor: c.surface,
              },
              sh.raised,
            ]}
          >
            <View style={{ borderRadius: 23, overflow: "hidden" }}>
              {/* iOS only, for now. On Android the carousel reliably takes down
                  the render thread with a stack overflow inside Android's own
                  libhwui — a SIGSEGV in RenderNode::prepareTreeImpl, recursing
                  hundreds of frames deep. It is not the parallax, the scrim or
                  the image component; each was ruled out separately, and the
                  screen is stable the moment the carousel is not mounted.
                  Until that is understood, Android gets the single framed hero
                  the design started from rather than a crash. */}
              {Platform.OS === "ios" ? (
                <MotionSlider slides={slides} height={HERO_HEIGHT} />
              ) : (
                <ExpoImage
                  source={HERO}
                  style={{ width: "100%", height: HERO_HEIGHT }}
                  {...photoDefaults}
                />
              )}
            </View>
          </View>
          <Glass
            style={[
              {
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                marginTop: -26,
                marginHorizontal: 12,
                paddingVertical: 14,
                paddingHorizontal: 15,
                borderRadius: 22,
                overflow: "hidden",
              },
              sh.raised,
            ]}
            solid={{ borderWidth: 1, borderColor: c.border, backgroundColor: c.surface }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: c.secondarySoft,
              }}
            >
              <Icon name="clock" size={20} color={c.secondary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Overline size={10} color={c.secondary}>
                Pickup pre-orders
              </Overline>
              <Body size={13.5} style={{ marginTop: 3 }}>
                Order by 6:00 PM, at least 1 day ahead.
              </Body>
            </View>
          </Glass>
        </View>
      </View>

      {/* The one thing a returning customer opens the app to check. It sits
          above the menu because "is it ready" beats "what else is there" for
          anyone who has an order in the oven. */}
      {live ? (
        <Pressable
          onPress={onTrack}
          onPressIn={haptics.tap}
          accessibilityRole="button"
          accessibilityLabel={`Order ${live.orderNumber}, ${statusFor(live.status, c).label}`}
          style={({ pressed }) => [{ paddingHorizontal: 20, marginTop: 22 }, pressed && { opacity: 0.9 }]}
        >
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: statusFor(live.status, c).bg,
              }}
            >
              <Icon name="bag" size={19} color={statusFor(live.status, c).fg} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Overline size={10} color={statusFor(live.status, c).fg}>
                {statusFor(live.status, c).label}
              </Overline>
              <Label size={14} numberOfLines={1}>
                {formatDate(live.pickupDate, today ?? "")} at {formatTime(live.pickupTime)}
              </Label>
            </View>
            <Icon name="chevronRight" size={16} color={c.inkSubtle} />
          </Card>
        </Pressable>
      ) : null}

      {/* Shortcuts into the menu rather than a second menu: the app opens on a
          dozen trays, and picking the shelf you want is faster than scrolling
          past the ones you do not. */}
      {categories.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 9, paddingHorizontal: 20, paddingTop: 22 }}
        >
          {categories.map((category) => (
            <Pressable
              key={category}
              onPress={() => onOpenCategory(category)}
              onPressIn={haptics.select}
              accessibilityRole="button"
              style={({ pressed }) => [
                {
                  paddingHorizontal: 15,
                  paddingVertical: 9,
                  borderRadius: radius.chip,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface,
                },
                sh.card,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Label size={13}>{category}</Label>
            </Pressable>
          ))}
        </ScrollView>

      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          marginTop: 26,
        }}
      >
        <Display size={34}>Party trays</Display>
        <Pressable onPress={onSeeAll} onPressIn={haptics.tap} hitSlop={10}>
          <Label size={14} color={c.brand}>
            See all
          </Label>
        </Pressable>
      </View>

      {/* A horizontal rail rather than a list, as the design has it: this is a
          shortcut into the menu, and a vertical list of three would read as the
          menu itself. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 14, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 }}
      >
        {loading && products.length === 0
          ? [0, 1].map((i) => (
              <View key={i} style={{ width: 224 }}>
                <CardSkeleton imageHeight={152} />
              </View>
            ))
          : null}
        {products.slice(0, 6).map((product) => (
          <Pressable
            key={product.id}
            onPress={() => onOpenProduct(product)}
            onPressIn={haptics.tap}
            accessibilityRole="button"
            accessibilityLabel={product.name}
            style={({ pressed }) => [{ width: 224 }, pressed && { opacity: 0.9 }]}
          >
            <Card padded={false} style={{ overflow: "hidden", borderRadius: 26 }}>
              <View>
                {product.imageUrl ? (
                  <Photo uri={product.imageUrl} style={{ width: "100%", height: 152 }} />
                ) : (
                  <View style={{ width: "100%", height: 152, backgroundColor: c.surfaceSunken }} />
                )}
                <View
                  style={{
                    position: "absolute",
                    top: 11,
                    left: 11,
                    paddingVertical: 4,
                    paddingHorizontal: 10,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: `${c.accentInk}38`,
                    backgroundColor: c.accentSoft,
                  }}
                >
                  {/* The design hardcodes "1 day"; the real lead time varies by
                      product, and a tray that needs three days saying one is a
                      promise the kitchen cannot keep. */}
                  <Label size={10.5} color={c.accentInk}>
                    {product.leadTimeDays > 0
                      ? `Order ${product.leadTimeDays} day${product.leadTimeDays === 1 ? "" : "s"} ahead`
                      : "Order today"}
                  </Label>
                </View>
              </View>

              <View style={{ paddingTop: 14, paddingHorizontal: 15, paddingBottom: 16 }}>
                <Display size={26} numberOfLines={2}>
                  {product.name}
                </Display>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    marginTop: 11,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "baseline",
                      gap: 5,
                      paddingVertical: 5,
                      paddingHorizontal: 11,
                      borderRadius: 999,
                      backgroundColor: c.surfaceSunken,
                    }}
                  >
                    <Overline size={9.5}>From</Overline>
                    <Display size={20} color={c.brand}>
                      {fromPrice(product) ?? ""}
                    </Display>
                  </View>
                  <Body size={11.5} color={c.inkSubtle}>
                    {product.variants.length} size{product.variants.length === 1 ? "" : "s"}
                  </Body>
                </View>
              </View>
            </Card>
          </Pressable>
        ))}
      </ScrollView>

      {/* PLACEHOLDER — this quote is hardcoded from the design, standing in for
          a live Google reviews widget. Do not treat it as curated copy: it puts
          words in a named person's mouth until the real feed replaces it.

          Whoever wires that up should know Google's terms constrain this
          layout — reviews must carry attribution and link back to Google, and
          they cannot be cached indefinitely — so expect an avatar, a rating and
          a link where there is now just a quote and a name. */}
      <View style={{ paddingTop: 22, paddingHorizontal: 20, paddingBottom: 30 }}>
        <Card style={{ borderRadius: 22, gap: 0 }}>
          {/* The design sets line-height .6 on this; in RN that crops the
              glyph out of existence. Natural leading, negative margins to close
              the gap it leaves. */}
          <Display size={44} color={c.accent} style={{ marginTop: -10, marginBottom: -12 }}>
            &ldquo;
          </Display>
          <Body size={14.5} color={c.ink} style={{ marginTop: 12 }}>
            Bread is always fresh, and staff are all friendly and accommodating
          </Body>
          <Body size={12} color={c.inkSubtle} style={{ marginTop: 12 }}>
            — Philip Beloso
          </Body>
        </Card>
      </View>

    </ScrollView>

      {/* Floating so the brand wash runs up behind it — frosted glass over a
          flat canvas shows nothing, and this is the only header in the app with
          something worth refracting underneath. Its height is measured rather
          than assumed: the shop name scales with Dynamic Type. */}
      <Glass
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          padding: 18,
          paddingTop: 6,
        }}
        solid={{ backgroundColor: c.canvas }}
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          setHeaderHeight((current) => (Math.abs(current - next) < 0.5 ? current : next));
        }}
      >
        <Pressable
          onPress={onChangeShop}
          onPressIn={haptics.tap}
          accessibilityRole="button"
          accessibilityLabel="Change pickup shop"
          style={({ pressed }) => [
            {
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderWidth: 1,
              borderColor: c.border,
              backgroundColor: c.surface,
              borderRadius: radius.chip,
              paddingVertical: 8,
              paddingLeft: 10,
              paddingRight: 14,
            },
            sh.card,
            pressed && { opacity: 0.85 },
          ]}
        >
          <View
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              backgroundColor: c.secondarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="pin" size={17} color={c.secondary} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Overline size={9.5}>Pickup from</Overline>
            <Label size={13} numberOfLines={1}>
              {shop ? `${shop.name.replace(/^Harina Bakeshoppe — /, "")} · ${shop.city ?? ""}` : "Choose a shop"}
            </Label>
          </View>
          <Icon name="chevronDown" size={15} color={c.inkSubtle} />
        </Pressable>
      </Glass>
    </View>
  );
}
