import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchQueue, type Queue as QueueData } from "../api";
import { formatDate, formatTime } from "../format";
import * as haptics from "../haptics";
import { theme } from "../theme";

/**
 * What to bake next.
 *
 * The same orders as the queue, pivoted. The queue is a list you work down at
 * the counter; this is what somebody reads at five in the morning, and at five
 * in the morning "3 × 25pc Ube" is useful where a column of customer names is
 * not. So the totals come first and the per-slot breakdown sits under them.
 *
 * The totals are summed on the server by the same function the web timeline
 * uses. Re-adding them here from the order items would be a second answer to
 * "what do we make today", and the two would disagree the first time an order
 * was cancelled.
 *
 * The web version draws lanes across a horizontal rail. That does not survive a
 * phone: sixty pickup times become sixty columns nobody can scan. Vertical
 * sections, and only days that actually have orders.
 */

const POLL_MS = 60_000;

export function Timeline({ token, onClose }: { token: string; onClose: () => void }) {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchQueue(token);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else {
      // Keep whatever is on screen; a kitchen mid-bake should not lose it.
      setError(result.error);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active) void load();
    };
    tick();
    /* A minute, not fifteen seconds. Nothing here changes between orders in a
       way anyone acts on, and this screen is often left open on a bench. */
    const timer = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (!data) {
    return (
      <View style={styles.centre}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={theme.brand} />}
        <Pressable onPress={onClose} onPressIn={haptics.tap} hitSlop={12}>
          <Text style={styles.link}>Back to pickups</Text>
        </Pressable>
      </View>
    );
  }

  const days = data.days.filter((day) => day.orderCount > 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Prep</Text>
        <Pressable onPress={onClose} onPressIn={haptics.tap} hitSlop={12}>
          <Text style={styles.link}>Done</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.staleBanner}>{error} Showing the last update.</Text> : null}

      {days.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Nothing booked</Text>
          <Text style={styles.emptyBody}>
            Nothing is scheduled for the week ahead. This updates itself as orders come in.
          </Text>
        </View>
      ) : (
        days.map((day) => (
          <View key={day.date} style={styles.day}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayTitle}>{formatDate(day.date, data.today)}</Text>
              <Text style={styles.dayCount}>
                {day.orderCount} order{day.orderCount === 1 ? "" : "s"}
              </Text>
            </View>

            {/* Totals first: this is the reason the screen exists. */}
            <View style={styles.production}>
              {day.production.map((line) => (
                <View key={line.name} style={styles.productionRow}>
                  <Text style={styles.productionQty}>{line.quantity}</Text>
                  <Text style={styles.productionName}>{line.name}</Text>
                </View>
              ))}
            </View>

            {day.slots
              .filter((slot) => slot.orders.length > 0)
              .map((slot) => (
                <View key={slot.time} style={styles.slot}>
                  <Text style={styles.slotTime}>{formatTime(slot.time)}</Text>
                  <View style={styles.slotOrders}>
                    {slot.orders.map((order) => (
                      <Text key={order.id} style={styles.slotOrder}>
                        {order.customerName}
                        <Text style={styles.slotItems}>
                          {" — "}
                          {order.items.map((item) => `${item.quantity} × ${item.name}`).join(", ")}
                        </Text>
                      </Text>
                    ))}
                  </View>
                </View>
              ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 24 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 30, fontWeight: "700", color: theme.ink },
  link: { color: theme.brand, fontWeight: "600", fontSize: 16 },
  staleBanner: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
  },
  error: { fontSize: 16, color: theme.danger, textAlign: "center", paddingHorizontal: 24 },
  empty: { alignItems: "center", gap: 6, paddingVertical: 64 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: theme.ink },
  emptyBody: { fontSize: 14, color: theme.inkMuted, textAlign: "center", paddingHorizontal: 24 },
  day: { gap: 12 },
  dayHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  dayTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  dayCount: { fontSize: 13, color: theme.inkSubtle },
  production: { backgroundColor: theme.surface, borderRadius: 18, padding: 16, gap: 10 },
  productionRow: { flexDirection: "row", alignItems: "baseline", gap: 12 },
  /* Fixed width and tabular figures so the numbers line up in a column — this is
     read at a glance, standing up, holding something. */
  productionQty: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.brand,
    minWidth: 44,
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  productionName: { flex: 1, fontSize: 17, color: theme.ink },
  slot: { flexDirection: "row", gap: 12, paddingHorizontal: 4 },
  slotTime: { fontSize: 14, fontWeight: "700", color: theme.ink, minWidth: 76 },
  slotOrders: { flex: 1, gap: 4 },
  slotOrder: { fontSize: 14, color: theme.ink },
  slotItems: { color: theme.inkMuted },
});
