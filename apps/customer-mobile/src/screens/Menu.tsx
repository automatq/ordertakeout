import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { availabilityOf, fromPrice, type Menu as MenuData, type MenuProduct } from "../api";
import * as haptics from "../haptics";
import { radius, shadows, useTheme } from "../theme";
import { Badge, Card, Chip } from "../ui/controls";
import { Photo } from "../ui/photo";
import { Icon } from "../ui/icons";
import { useTabBarSpace } from "../ui/chrome";
import { CardSkeleton, Skeleton } from "../ui/skeleton";
import { Body, Display, Label, Overline } from "../ui/text";

const ALL = "All";

/**
 * The trays.
 *
 * Category chips over a search field, because the whole menu is a dozen items
 * and scrolling past two of them is faster than typing. Search is still there
 * for anyone who reaches for it.
 */
export function Menu({
  data,
  initialCategory,
  error,
  refreshing,
  onRefresh,
  onOpen,
  onChangeShop,
}: {
  data: MenuData | null;
  /** The shelf to open on, when arriving from a home shortcut. */
  initialCategory?: string | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: (product: MenuProduct) => void;
  onChangeShop: () => void;
}) {
  const { c, scheme } = useTheme();
  const chrome = useTabBarSpace();
  const sh = shadows(scheme);
  /* Initial state, not a synced prop: this screen unmounts when you leave it,
     so it is re-read on every arrival, and a filter the customer changes while
     here must not be yanked back by a stale prop. */
  const [category, setCategory] = useState(initialCategory ?? ALL);

  const categories = useMemo(
    () => [ALL, ...(data?.groups.map((group) => group.category) ?? [])],
    [data],
  );
  const products = useMemo(() => {
    if (!data) return [];
    return data.groups
      .filter((group) => category === ALL || group.category === category)
      .flatMap((group) => group.products);
  }, [data, category]);

  /* Error first: with no data and a reason for it, the reason is the screen.
     Without one we are simply still loading. */
  if (!data && error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
        <Body color={c.ink} style={{ textAlign: "center" }}>
          {error}
        </Body>
        <Pressable onPress={onRefresh} onPressIn={haptics.tap} hitSlop={10}>
          <Label color={c.brand}>Try again</Label>
        </Pressable>
      </View>
    );
  }

  /* The menu is a column of product cards; two of their outlines say "trays are
     coming" in a way a spinner in the middle of nothing cannot. */
  if (!data) {
    return (
      <View style={{ gap: 18, padding: 20, paddingBottom: 20 + chrome }}>
        <Skeleton style={{ width: "55%", height: 38, marginBottom: 4 }} />
        <CardSkeleton />
        <CardSkeleton />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: 30 + chrome }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.brand} />}
      stickyHeaderIndices={[0]}
    >
      <View style={{ backgroundColor: c.canvas, paddingTop: 6, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingHorizontal: 20,
          }}
        >
          <Display size={38}>The trays</Display>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}
        >
          {categories.map((name) => (
            <Chip
              key={name}
              label={name}
              selected={category === name}
              onPress={() => setCategory(name)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Said once, above the list, and it is a button — the sentence is no use
          without a way to act on it. */}
      <Pressable
        onPress={onChangeShop}
        onPressIn={haptics.tap}
        style={{ paddingHorizontal: 20, paddingTop: 14 }}
        hitSlop={6}
      >
        <Label size={13.5} color={c.brand}>
          {data.locationId === null
            ? "Choose a pickup shop to see what's in stock today"
            : "Change pickup shop"}
        </Label>
      </Pressable>

      <View style={{ gap: 18, padding: 20 }}>
        {products.map((product) => {
          const state = availabilityOf(product);
          return (
            <Pressable
              key={product.id}
              onPress={() => onOpen(product)}
              onPressIn={haptics.tap}
              accessibilityRole="button"
              accessibilityLabel={product.name}
              style={({ pressed }) => [pressed && { opacity: 0.92 }]}
            >
              <Card padded={false} style={{ borderRadius: radius.cardLarge, overflow: "hidden" }}>
                <View>
                  {product.imageUrl ? (
                    <Photo uri={product.imageUrl} style={{ width: "100%", height: 196 }} />
                  ) : (
                    <View style={{ width: "100%", height: 196, backgroundColor: c.surfaceSunken }} />
                  )}
                  <View style={{ position: "absolute", top: 13, left: 13 }}>
                    <Badge
                      label={
                        product.leadTimeDays > 0
                          ? `Order ${product.leadTimeDays} day${product.leadTimeDays === 1 ? "" : "s"} ahead`
                          : "Order today"
                      }
                      tint={c.accentInk}
                      background={c.accentSoft}
                      border={c.accentInk + "38"}
                    />
                  </View>
                  {/* Only ever shown when the shop actually said so — unknown
                      stock stays silent rather than implying either answer. */}
                  {state === "sold-out" ? (
                    <View style={{ position: "absolute", top: 13, right: 13 }}>
                      <Badge label="Sold out today" tint={c.danger} background={c.dangerSoft} />
                    </View>
                  ) : null}
                </View>

                <View style={{ padding: 18, paddingTop: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <Display size={30} style={{ flex: 1 }}>
                      {product.name}
                    </Display>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "baseline",
                        gap: 5,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: radius.chip,
                        backgroundColor: c.surfaceSunken,
                      }}
                    >
                      <Overline size={10}>From</Overline>
                      <Display size={21} color={c.brand}>
                        {fromPrice(product) ?? ""}
                      </Display>
                    </View>
                  </View>

                  {product.description ? (
                    <Body size={13.5} style={{ marginTop: 9 }} numberOfLines={3}>
                      {product.description}
                    </Body>
                  ) : null}

                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: 14,
                      minHeight: 46,
                      borderWidth: 2,
                      borderColor: c.brand + "5C",
                      borderRadius: radius.chip,
                      paddingHorizontal: 16,
                    }}
                  >
                    <Label size={13.5} color={c.brand}>
                      {product.variants.length} size{product.variants.length === 1 ? "" : "s"}
                    </Label>
                    <Icon name="arrowRight" size={16} color={c.brand} />
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })}

        <Body size={12} color={c.inkSubtle} style={{ textAlign: "center", marginTop: 2 }}>
          Counter items — pandesal, monay, shakoy — are sold in store, no pre-order needed.
        </Body>
      </View>
    </ScrollView>
  );
}
