import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import { fetchOrder, formatMoney, type CustomerOrder } from "../api";
import { formatDate, formatTime } from "../format";
import { loadSavedOrder, saveOrder, type SavedOrder } from "../saved-order";
import { statusStyle, theme } from "../theme";

/**
 * Your order, and the code to collect it with.
 *
 * Opens from the stored copy first and refreshes behind it. That order matters:
 * the one moment this screen has to work is standing at a counter in a shop with
 * no signal, and a screen that waits for a network call before showing anything
 * is a screen that shows a spinner exactly then.
 */
export function Order({
  orderNumber,
  accessKey,
  onClose,
}: {
  orderNumber: string;
  accessKey: string;
  onClose: () => void;
}) {
  const [saved, setSaved] = useState<SavedOrder | null>(null);
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [today, setToday] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [gone, setGone] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    const result = await fetchOrder(orderNumber, accessKey);
    if (!result.ok) {
      // Keep showing the stored copy; say it might be out of date.
      setOffline(true);
      return;
    }
    setOffline(false);
    if (!result.data.found) {
      setGone(true);
      return;
    }
    setOrder(result.data.order);
    setToday(result.data.today);
    await saveOrder(orderNumber, accessKey, result.data.order);
  }, [orderNumber, accessKey]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await loadSavedOrder();
      if (!active) return;
      if (stored?.orderNumber === orderNumber) {
        setSaved(stored);
        setOrder(stored.order);
      }
      await refresh();
    })();
    return () => {
      active = false;
    };
  }, [orderNumber, refresh]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (gone && !order) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>Can't find that order</Text>
        <Text style={styles.body}>
          Check the link in your confirmation email or text — it carries the code that opens it.
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Back to the menu</Text>
        </Pressable>
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color={theme.brand} />
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Back to the menu</Text>
        </Pressable>
      </View>
    );
  }

  const status = statusStyle[order.status] ?? {
    label: order.status,
    bg: theme.canvas,
    fg: theme.inkMuted,
  };
  const phoneHref = order.pickup.phone ? `tel:${order.pickup.phone.replace(/[^+\d]/g, "")}` : null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.brand} />
      }
    >
      <Pressable onPress={onClose} hitSlop={12} style={styles.backRow}>
        <Text style={styles.link}>← Menu</Text>
      </Pressable>

      <View style={styles.headline}>
        <Text style={styles.orderNumber}>{order.orderNumber}</Text>
        <Text style={[styles.pill, { backgroundColor: status.bg, color: status.fg }]}>
          {status.label}
        </Text>
      </View>

      <Text style={styles.when}>
        {formatDate(order.pickupDate, today ?? "")} at {formatTime(order.pickupTime)}
      </Text>

      {/* Said plainly rather than hidden: a stale total is fine, a stale
          "ready to collect" is the sort of thing people plan a trip around. */}
      {offline && saved ? (
        <Text style={styles.offlineBanner}>
          Can't reach the shop right now. This is how things stood when you last had signal — your
          collection code still works.
        </Text>
      ) : null}

      {order.pickupPass ? (
        <View style={styles.passCard}>
          <Text style={styles.passLabel}>Show this at the counter</Text>
          <View style={styles.qrFrame}>
            <QRCode value={order.pickupPass} size={200} backgroundColor="#ffffff" />
          </View>
          <Text style={styles.passHint}>
            Works without signal. If the scanner won't read it, they can look you up by{" "}
            {order.orderNumber}.
          </Text>
        </View>
      ) : null}

      <View style={styles.card}>
        {order.items.map((item, index) => (
          <View key={`${item.name}-${index}`} style={styles.line}>
            <Text style={styles.lineName}>
              {item.quantity} × {item.name}
            </Text>
            <Text style={styles.lineTotal}>
              {formatMoney(item.totalPriceCents, order.currency)}
            </Text>
          </View>
        ))}

        <View style={styles.rule} />
        <Total label="Subtotal" cents={order.subtotalCents} currency={order.currency} />
        {order.taxCents > 0 ? (
          <Total label="Tax" cents={order.taxCents} currency={order.currency} />
        ) : null}
        {order.tipCents > 0 ? (
          <Total label="Tip" cents={order.tipCents} currency={order.currency} />
        ) : null}
        <Total label="Total" cents={order.totalCents} currency={order.currency} strong />
      </View>

      {order.customerNote ? (
        <View style={styles.card}>
          <Text style={styles.blockTitle}>Your note</Text>
          <Text style={styles.body}>{order.customerNote}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.blockTitle}>Collect from</Text>
        {order.pickup.name ? <Text style={styles.shopName}>{order.pickup.name}</Text> : null}
        <Text style={styles.body}>
          {order.pickup.address}
          {order.pickup.city ? `, ${order.pickup.city}` : ""}
        </Text>
        {phoneHref ? (
          <Pressable onPress={() => void Linking.openURL(phoneHref)} hitSlop={8}>
            <Text style={styles.link}>{order.pickup.phone}</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Total({
  label,
  cents,
  currency,
  strong,
}: {
  label: string;
  cents: number;
  currency: string;
  strong?: boolean;
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineName, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineTotal, strong && styles.strong]}>
        {formatMoney(cents, currency)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 14 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 14, padding: 24 },
  backRow: { alignSelf: "flex-start" },
  link: { color: theme.brand, fontWeight: "600", fontSize: 16 },
  headline: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  orderNumber: { fontSize: 28, fontWeight: "700", color: theme.ink },
  pill: {
    fontSize: 13,
    fontWeight: "700",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: "hidden",
  },
  when: { fontSize: 17, color: theme.inkMuted, marginTop: -8 },
  offlineBanner: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  passCard: { backgroundColor: theme.surface, borderRadius: 24, padding: 20, alignItems: "center", gap: 12 },
  passLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  qrFrame: { backgroundColor: "#ffffff", padding: 14, borderRadius: 16 },
  passHint: { fontSize: 13, color: theme.inkMuted, textAlign: "center", lineHeight: 19 },
  card: { backgroundColor: theme.surface, borderRadius: 20, padding: 16, gap: 8 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineName: { flex: 1, fontSize: 15, color: theme.inkMuted },
  lineTotal: { fontSize: 15, color: theme.inkMuted },
  strong: { color: theme.ink, fontWeight: "700" },
  rule: { height: 1, backgroundColor: theme.border, marginVertical: 4 },
  blockTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  shopName: { fontSize: 16, fontWeight: "600", color: theme.ink },
  title: { fontSize: 22, fontWeight: "700", color: theme.ink, textAlign: "center" },
  body: { fontSize: 15, color: theme.inkMuted, lineHeight: 21 },
});
