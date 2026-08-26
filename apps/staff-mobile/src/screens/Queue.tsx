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

import { fetchQueue, type Queue as QueueData, type QueueOrder } from "../api";
import type { Protection } from "../session";
import { formatDate, formatMoney, formatTime } from "../format";
import { statusStyle, theme } from "../theme";

/** How often the queue refreshes itself while the screen is open. */
const POLL_MS = 15_000;

export function Queue({
  token,
  protection,
  onSignedOut,
  onScan,
}: {
  token: string;
  protection: Protection;
  onSignedOut: () => void;
  onScan: () => void;
}) {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchQueue(token);
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else if (result.unauthorized) {
      /* The token died — expired, or the shared password was rotated. Drop it
         and go back to the login screen rather than showing an empty queue with
         an error, which reads as "no orders today". */
      onSignedOut();
    } else {
      /* Keep whatever was last on screen. A tablet that loses Wi-Fi for ten
         seconds should not blank the queue the kitchen is working from. */
      setError(result.error);
    }
  }, [token, onSignedOut]);

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active) void load();
    };
    tick();
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
        {error ? (
          <>
            <Text style={styles.errorTitle}>{error}</Text>
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

  const empty = data.days.every((day) => day.orderCount === 0);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
      }
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Pickups</Text>
          <Text style={styles.subtitle}>
            {data.newOrderCount > 0
              ? `${data.newOrderCount} not started yet`
              : "Everything's been started"}
          </Text>
        </View>
        <Pressable onPress={onSignedOut} hitSlop={12}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {/* The counter's main action, so it sits above the list rather than behind
          a menu. Someone is standing there waiting. */}
      <Pressable
        onPress={onScan}
        style={({ pressed }) => [styles.scanButton, pressed && styles.scanPressed]}
      >
        <Text style={styles.scanText}>Scan a pickup pass</Text>
      </Pressable>

      {/* Shown above the list, not instead of it — the stale queue is still
          the most useful thing on screen while the connection is down. */}
      {error ? <Text style={styles.staleBanner}>{error} Showing the last update.</Text> : null}

      {/* A tablet with no passcode holds a staff token nothing is guarding. That
          is worth a permanent strip rather than a note in a settings screen
          nobody opens — the same reasoning as a smoke alarm with the battery
          out. */}
      {protection === "device-only" ? (
        <Text style={styles.insecureBanner}>
          This device has no passcode or fingerprint, so the app can't lock itself. Anyone
          holding it can read every order.
        </Text>
      ) : null}

      {empty ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No pickups booked</Text>
          <Text style={styles.emptyBody}>Orders appear here as soon as they're paid for.</Text>
        </View>
      ) : (
        data.days
          .filter((day) => day.orderCount > 0)
          .map((day) => (
            <View key={day.date} style={styles.day}>
              <Text style={styles.dayTitle}>{formatDate(day.date, data.today)}</Text>
              {day.slots
                .filter((slot) => slot.orders.length > 0)
                .map((slot) => (
                  <View key={slot.time} style={styles.slot}>
                    <Text style={styles.slotTitle}>
                      {formatTime(slot.time)}
                      <Text style={styles.slotCount}>
                        {"  "}
                        {slot.orders.length} of {slot.capacity}
                      </Text>
                    </Text>
                    {slot.orders.map((order) => (
                      <OrderCard key={order.id} order={order} />
                    ))}
                  </View>
                ))}
            </View>
          ))
      )}
    </ScrollView>
  );
}

function OrderCard({ order }: { order: QueueOrder }) {
  const status = statusStyle[order.status] ?? {
    label: order.status,
    bg: theme.canvas,
    fg: theme.inkMuted,
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardIdentity}>
          <Text style={styles.customer}>{order.customerName}</Text>
          <Text style={styles.orderNumber}>{order.orderNumber}</Text>
        </View>
        <Text style={[styles.pill, { backgroundColor: status.bg, color: status.fg }]}>
          {order.verifiedAt ? "Collected" : status.label}
        </Text>
      </View>

      {order.items.map((item, index) => (
        <Text key={`${item.name}-${index}`} style={styles.item}>
          {item.quantity} × {item.name}
        </Text>
      ))}

      {order.customerNote ? (
        <Text style={styles.note}>“{order.customerNote}”</Text>
      ) : null}

      <View style={styles.cardBottom}>
        <Text style={styles.total}>{formatMoney(order.totalCents, order.currency)}</Text>
        {order.customerPhone ? (
          <Text style={styles.phone}>{order.customerPhone}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 20 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 30, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 15, color: theme.inkMuted, marginTop: 2 },
  signOut: { fontSize: 15, color: theme.brand, fontWeight: "600", paddingTop: 8 },
  staleBanner: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
  },
  scanButton: {
    backgroundColor: theme.brand,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
  },
  scanPressed: { opacity: 0.85 },
  scanText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  insecureBanner: {
    backgroundColor: "#fee2e2",
    color: theme.danger,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  errorTitle: { fontSize: 16, color: theme.ink },
  retry: { backgroundColor: theme.brand, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  retryText: { color: "#fff", fontWeight: "600" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 64 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: theme.ink },
  emptyBody: { fontSize: 14, color: theme.inkMuted },
  day: { gap: 12 },
  dayTitle: { fontSize: 13, fontWeight: "700", color: theme.inkSubtle, textTransform: "uppercase", letterSpacing: 0.6 },
  slot: { gap: 8 },
  slotTitle: { fontSize: 17, fontWeight: "700", color: theme.ink },
  slotCount: { fontSize: 14, fontWeight: "500", color: theme.inkSubtle },
  card: { backgroundColor: theme.surface, borderRadius: 18, padding: 16, gap: 6 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  cardIdentity: { flex: 1 },
  customer: { fontSize: 17, fontWeight: "600", color: theme.ink },
  orderNumber: { fontSize: 13, color: theme.inkSubtle, marginTop: 1 },
  pill: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  item: { fontSize: 15, color: theme.inkMuted },
  note: { fontSize: 14, color: theme.inkMuted, fontStyle: "italic", marginTop: 2 },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  total: { fontSize: 15, fontWeight: "700", color: theme.ink },
  phone: { fontSize: 15, color: theme.brand },
});
