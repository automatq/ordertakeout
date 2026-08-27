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

import { fetchAccountOrders, formatMoney, type AccountOrder } from "../api";
import { formatDate, formatTime } from "../format";
import { statusStyle, theme } from "../theme";

/**
 * Everything you have ordered.
 *
 * Newest first, and the past is kept rather than hidden — "what did I get last
 * time" is most of why anybody opens this, and reordering is the obvious thing
 * to build on top of it once checkout exists.
 */
export function Orders({
  token,
  onClose,
  onSignedOut,
}: {
  token: string;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [orders, setOrders] = useState<AccountOrder[] | null>(null);
  /* The shop's today, not the device's — an order is due on the day the bakery
     says it is, wherever the customer happens to be standing. */
  const [today, setToday] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchAccountOrders(token);
    if (result.ok) {
      setOrders(result.data.orders);
      setToday(result.data.today);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Your orders</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Done</Text>
        </Pressable>
      </View>

      {!orders ? (
        error ? (
          <View style={styles.centre}>
            <Text style={styles.body}>{error}</Text>
            <Pressable onPress={onRefresh} style={styles.primary}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (
          <ActivityIndicator color={theme.brand} style={styles.spinner} />
        )
      ) : orders.length === 0 ? (
        <View style={styles.centre}>
          <Text style={styles.emptyTitle}>Nothing yet</Text>
          <Text style={styles.body}>Orders you place will show up here.</Text>
        </View>
      ) : (
        orders.map((order) => {
          const status = statusStyle[order.status] ?? {
            label: order.status,
            bg: theme.canvas,
            fg: theme.inkMuted,
          };
          return (
            <View key={order.orderNumber} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.orderNumber}>{order.orderNumber}</Text>
                <Text style={[styles.pill, { backgroundColor: status.bg, color: status.fg }]}>
                  {status.label}
                </Text>
              </View>
              <Text style={styles.when}>
                {formatDate(order.pickupDate, today ?? "")} at {formatTime(order.pickupTime)}
                {order.pickupLocationName ? ` · ${order.pickupLocationName}` : ""}
              </Text>
              {order.items.map((item, index) => (
                <Text key={`${item.name}-${index}`} style={styles.item}>
                  {item.quantity} × {item.name}
                </Text>
              ))}
              <Text style={styles.total}>{formatMoney(order.totalCents, order.currency)}</Text>
            </View>
          );
        })
      )}

      <Pressable onPress={onSignedOut} hitSlop={12}>
        <Text style={styles.signOut}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 30, fontWeight: "700", color: theme.ink },
  link: { color: theme.brand, fontWeight: "600", fontSize: 16 },
  centre: { alignItems: "center", gap: 12, paddingVertical: 48 },
  spinner: { paddingVertical: 48 },
  emptyTitle: { fontSize: 17, fontWeight: "600", color: theme.ink },
  body: { fontSize: 15, color: theme.inkMuted, textAlign: "center", lineHeight: 21 },
  card: { backgroundColor: theme.surface, borderRadius: 20, padding: 16, gap: 4 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  orderNumber: { fontSize: 17, fontWeight: "700", color: theme.ink },
  pill: {
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
  },
  when: { fontSize: 14, color: theme.inkSubtle },
  item: { fontSize: 15, color: theme.inkMuted },
  total: { fontSize: 15, fontWeight: "700", color: theme.ink, marginTop: 4 },
  primary: { backgroundColor: theme.brand, borderRadius: 999, paddingHorizontal: 24, paddingVertical: 12 },
  primaryText: { color: "#fff", fontWeight: "600" },
  signOut: { color: theme.inkSubtle, fontWeight: "600", fontSize: 15, textAlign: "center", paddingVertical: 16 },
});
