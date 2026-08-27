import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { fetchShops, type PickupShop } from "../api";
import { formatTime } from "../format";
import { theme } from "../theme";

/**
 * Choose where to collect from.
 *
 * The first thing the app asks, because until it is answered nothing can be
 * said about stock — and "we don't know" on every price is a poor first
 * impression for a shop that does in fact have the cake.
 *
 * Skippable. Somebody browsing to see whether this bakery is worth a trip
 * should not be made to commit to a branch first; the menu handles not knowing.
 */
export function Shops({
  chosenId,
  onChoose,
  onSkip,
}: {
  chosenId: string | null;
  onChoose: (shop: PickupShop) => void;
  onSkip: () => void;
}) {
  const [shops, setShops] = useState<PickupShop[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchShops();
    if (result.ok) {
      setShops(result.data.shops);
      setError(null);
    } else {
      setError(result.error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!shops) {
    return (
      <View style={styles.centre}>
        {error ? (
          <>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={load} style={styles.primary}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
            {/* Never a dead end: the menu works without a shop. */}
            <Pressable onPress={onSkip} hitSlop={12}>
              <Text style={styles.link}>See the menu anyway</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color={theme.brand} />
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Where will you collect?</Text>
      <Text style={styles.subtitle}>
        We'll show you what's in stock there. You can change this any time.
      </Text>

      {shops.map((shop) => (
        <Pressable
          key={shop.id}
          onPress={() => onChoose(shop)}
          style={({ pressed }) => [
            styles.card,
            shop.id === chosenId && styles.cardChosen,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.shopName}>{shop.name}</Text>
          <Text style={styles.shopAddress}>
            {shop.address}
            {shop.city ? `, ${shop.city}` : ""}
          </Text>
          <Text style={styles.shopHours}>{todayHours(shop)}</Text>
        </Pressable>
      ))}

      <Pressable onPress={onSkip} hitSlop={12}>
        <Text style={styles.link}>Just browsing</Text>
      </Pressable>
    </ScrollView>
  );
}

const DAY_KEYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * Today's opening hours, in the device's own reckoning of what day it is.
 *
 * Deliberately not a pickup date calculation — those are store-local and stay
 * strings. This is "what day is it where you are standing", which for somebody
 * deciding whether to walk over is the right question.
 */
function todayHours(shop: PickupShop): string {
  const key = DAY_KEYS[new Date().getDay()];
  const period = shop.hours.find((entry) => entry.dayOfWeek.toUpperCase().startsWith(key ?? ""));
  if (!period) return "Closed today";
  return `Open today ${formatTime(period.startTime)} – ${formatTime(period.endTime)}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 72, paddingBottom: 48, gap: 12 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 28, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 16, color: theme.inkMuted, marginTop: -6, marginBottom: 6 },
  card: { backgroundColor: theme.surface, borderRadius: 20, padding: 18, gap: 4, borderWidth: 2, borderColor: "transparent" },
  cardChosen: { borderColor: theme.brand },
  pressed: { opacity: 0.85 },
  shopName: { fontSize: 17, fontWeight: "600", color: theme.ink },
  shopAddress: { fontSize: 15, color: theme.inkMuted },
  shopHours: { fontSize: 14, color: theme.inkSubtle, marginTop: 2 },
  error: { fontSize: 16, color: theme.ink, textAlign: "center" },
  primary: { backgroundColor: theme.brand, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  primaryText: { color: theme.brandInk, fontWeight: "600" },
  link: { color: theme.brand, fontWeight: "600", fontSize: 15, textAlign: "center", paddingVertical: 10 },
});
