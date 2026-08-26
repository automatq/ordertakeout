import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  availabilityOf,
  fetchMenu,
  fromPrice,
  type Menu as MenuData,
  type MenuProduct,
} from "../api";
import { theme } from "../theme";

/**
 * The menu.
 *
 * Not a port of the web homepage. That page is 634 lines of marketing written
 * to convince a stranger the bakery is worth trying; somebody who has installed
 * the app is past that argument and wants to know what there is and whether it
 * can be had. So the app opens on the food.
 */
export function Menu({
  locationId,
  onOpen,
  onChangeShop,
  savedOrderNumber,
  onOpenOrder,
}: {
  locationId: string | null;
  onOpen: (product: MenuProduct) => void;
  onChangeShop: () => void;
  savedOrderNumber: string | null;
  onOpenOrder: () => void;
}) {
  const [data, setData] = useState<MenuData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchMenu(locationId);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      // Keep whatever is on screen — a stale menu still tells you what they bake.
      setError(result.error);
    }
  }, [locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!data) {
    return (
      <View style={styles.centre}>
        {error ? (
          <>
            {/* Before the apology, because somebody with an order to collect and
                no signal opened the app for exactly one reason, and a menu they
                cannot load is not it. This is the case the offline pass exists
                for; hiding it behind a network call would defeat the whole
                point. */}
            {savedOrderNumber ? (
              <SavedOrderCard orderNumber={savedOrderNumber} onPress={onOpenOrder} />
            ) : null}
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={onRefresh} style={styles.retry}>
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={theme.brand} />
        )}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
      }
    >
      <Text style={styles.title}>Harina Bakeshoppe</Text>
      <Text style={styles.subtitle}>Order ahead, collect in store.</Text>

      {/* Above the menu, because somebody with an order to collect opened the
          app to collect it, not to browse. */}
      {savedOrderNumber ? (
        <SavedOrderCard orderNumber={savedOrderNumber} onPress={onOpenOrder} />
      ) : null}

      {error ? <Text style={styles.staleBanner}>{error} Showing the last menu.</Text> : null}

      {/* Said once, at the top, rather than repeated on every card — and it is a
          button, because the sentence is useless without a way to act on it. */}
      <Pressable onPress={onChangeShop} style={({ pressed }) => [pressed && styles.pressed]}>
        <Text style={data.locationId === null ? styles.unknownBanner : styles.shopBanner}>
          {data.locationId === null
            ? "Choose a pickup shop to see what's in stock today."
            : "Change pickup shop"}
        </Text>
      </Pressable>

      {data.groups.map((group) => (
        <View key={group.category} style={styles.group}>
          <Text style={styles.groupTitle}>{group.category}</Text>
          {group.products.map((product) => (
            <ProductCard key={product.id} product={product} onPress={() => onOpen(product)} />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function SavedOrderCard({
  orderNumber,
  onPress,
}: {
  orderNumber: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.orderCard, pressed && styles.pressed]}
    >
      <Text style={styles.orderCardTitle}>Your order {orderNumber}</Text>
      <Text style={styles.orderCardBody}>Tap to show your collection code</Text>
    </Pressable>
  );
}

function ProductCard({ product, onPress }: { product: MenuProduct; onPress: () => void }) {
  const state = availabilityOf(product);
  const price = fromPrice(product);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={product.name}
    >
      {product.imageUrl ? (
        <Image source={{ uri: product.imageUrl }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}

      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{product.name}</Text>
        {product.description ? (
          <Text style={styles.cardDescription} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}

        <View style={styles.cardFooter}>
          {price ? <Text style={styles.price}>from {price}</Text> : null}
          {/* Only ever says "sold out" when the shop actually said so. */}
          {state === "sold-out" ? <Text style={styles.soldOut}>Sold out today</Text> : null}
          {product.leadTimeDays > 0 ? (
            <Text style={styles.lead}>
              {product.leadTimeDays} day{product.leadTimeDays === 1 ? "" : "s"} ahead
            </Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 16 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 30, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 16, color: theme.inkMuted, marginTop: -10 },
  error: { fontSize: 16, color: theme.ink, textAlign: "center", paddingHorizontal: 24 },
  retry: { backgroundColor: theme.brand, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: "#fff", fontWeight: "600" },
  staleBanner: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
  },
  unknownBanner: {
    backgroundColor: theme.surface,
    color: theme.inkMuted,
    padding: 12,
    borderRadius: 12,
    fontSize: 14,
  },
  orderCard: { backgroundColor: theme.brand, borderRadius: 20, padding: 16, gap: 2, alignSelf: "stretch" },
  orderCardTitle: { fontSize: 17, fontWeight: "700", color: "#fff" },
  orderCardBody: { fontSize: 14, color: "#ffffffcc" },
  shopBanner: {
    color: theme.brand,
    fontWeight: "600",
    fontSize: 14,
    paddingVertical: 4,
  },
  group: { gap: 10 },
  groupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 12,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
  pressed: { opacity: 0.85 },
  thumb: { width: 84, height: 84, borderRadius: 14, backgroundColor: theme.canvas },
  thumbEmpty: { borderWidth: 1, borderColor: theme.border },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 17, fontWeight: "600", color: theme.ink },
  cardDescription: { fontSize: 14, color: theme.inkMuted, lineHeight: 19 },
  cardFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 3 },
  price: { fontSize: 15, fontWeight: "700", color: theme.ink },
  soldOut: { fontSize: 13, fontWeight: "600", color: theme.danger },
  lead: { fontSize: 13, color: theme.inkSubtle },
});
