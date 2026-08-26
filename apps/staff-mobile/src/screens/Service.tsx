import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import {
  fetchService,
  markSoldOut,
  putBackOn,
  setPaused,
  type ServiceState,
} from "../api";
import { theme } from "../theme";

/**
 * The "something has gone wrong" screen: stop taking orders, and say what has
 * run out.
 *
 * Both belong together because they are the same moment — the oven died, or the
 * ube ran out, and somebody needs to say so before the next order arrives. Any
 * delay here is an order the shop cannot fill, so every control is one tap and
 * nothing is behind a menu.
 */
export function Service({
  token,
  onClose,
  onChanged,
}: {
  token: string;
  onClose: () => void;
  /** So the queue reloads: pausing changes what the storefront will accept. */
  onChanged: () => void;
}) {
  const [state, setState] = useState<ServiceState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(async () => {
    const result = await fetchService(token);
    if (result.ok) {
      setState(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Every mutation reloads rather than patching local state. These are the
     controls that decide whether the shop is taking money; showing a toggle as
     flipped when the write failed is the one outcome worth ruling out. */
  const apply = useCallback(
    async (run: () => Promise<{ ok: boolean; data?: unknown; error?: string }>) => {
      if (busy) return;
      setBusy(true);
      const result = await run();
      if (!result.ok) {
        setError(result.error ?? "That didn't go through.");
      } else {
        const applied = result.data as { applied: boolean; reason?: string };
        setError(applied.applied ? null : (applied.reason ?? "That didn't go through."));
      }
      await load();
      onChanged();
      setBusy(false);
    },
    [busy, load, onChanged],
  );

  if (!state) {
    return (
      <View style={styles.centre}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={theme.brand} />}
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Back to pickups</Text>
        </Pressable>
      </View>
    );
  }

  if (picking) {
    return (
      <ProductPicker
        state={state}
        busy={busy}
        onCancel={() => setPicking(false)}
        onPick={(productId) => {
          setPicking(false);
          void apply(() =>
            markSoldOut(
              token,
              productId,
              state.locations.map((location) => location.id),
              state.today,
            ),
          );
        }}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Service</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.link}>Done</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>Taking orders</Text>
      <Row
        label="Everywhere"
        detail={
          state.global.paused
            ? state.global.note ?? "Paused — the storefront is not accepting orders"
            : "The storefront is accepting orders"
        }
        value={!state.global.paused}
        disabled={busy}
        onChange={(taking) => void apply(() => setPaused(token, "global", !taking))}
      />

      {state.locations.map((location) => (
        <Row
          key={location.id}
          label={location.name}
          detail={
            state.global.paused
              ? "Paused everywhere"
              : location.paused
                ? location.note ?? "Paused"
                : "Taking orders"
          }
          /* A branch toggle looks off while the whole shop is paused, because it
             is: turning it on here would change nothing a customer can see. */
          value={!state.global.paused && !location.paused}
          disabled={busy || state.global.paused}
          onChange={(taking) =>
            void apply(() => setPaused(token, { locationId: location.id }, !taking))
          }
        />
      ))}

      <View style={styles.sectionGap}>
        <Text style={styles.sectionTitle}>Sold out today</Text>
        {state.soldOut.length === 0 ? (
          <Text style={styles.empty}>Everything on the menu is still available.</Text>
        ) : (
          state.soldOut.map((entry) => (
            <View key={entry.id} style={styles.card}>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{entry.productName}</Text>
                <Text style={styles.cardDetail}>
                  {entry.locationName}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => void apply(() => putBackOn(token, entry.id))}
                disabled={busy}
                style={({ pressed }) => [styles.small, busy && styles.disabled, pressed && styles.pressed]}
              >
                <Text style={styles.smallText}>Back on</Text>
              </Pressable>
            </View>
          ))
        )}

        <Pressable
          onPress={() => setPicking(true)}
          disabled={busy || state.products.length === 0}
          style={({ pressed }) => [
            styles.primary,
            (busy || state.products.length === 0) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.primaryText}>Mark something sold out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function Row({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{label}</Text>
        <Text style={styles.cardDetail}>{detail}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: theme.ok }}
        accessibilityLabel={`${label} taking orders`}
      />
    </View>
  );
}

/**
 * Sold out applies to every branch at once.
 *
 * Per-location would be more precise and it is what the web dashboard offers.
 * At a counter the person tapping this is standing in one shop, has just looked
 * in one empty tray, and picking branches is a question they cannot answer for
 * anywhere else. The dashboard is where the careful version lives.
 */
function ProductPicker({
  state,
  busy,
  onPick,
  onCancel,
}: {
  state: ServiceState;
  busy: boolean;
  onPick: (productId: string) => void;
  onCancel: () => void;
}) {
  const soldOut = new Set(state.soldOut.map((entry) => entry.productId));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Sold out</Text>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </View>
      <Text style={styles.empty}>Marks it unavailable at every branch for the rest of today.</Text>

      {state.products.map((product) => {
        const already = soldOut.has(product.id);
        return (
          <Pressable
            key={product.id}
            onPress={() => !already && onPick(product.id)}
            disabled={busy || already}
            style={({ pressed }) => [styles.card, already && styles.disabled, pressed && styles.pressed]}
          >
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{product.name}</Text>
              {already ? <Text style={styles.cardDetail}>Already marked sold out</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  content: { padding: 16, paddingTop: 64, paddingBottom: 48, gap: 10 },
  centre: { flex: 1, backgroundColor: theme.canvas, alignItems: "center", justifyContent: "center", gap: 16 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 30, fontWeight: "700", color: theme.ink },
  link: { color: theme.brand, fontWeight: "600", fontSize: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.inkSubtle,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 8,
  },
  sectionGap: { gap: 10, marginTop: 16 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: theme.ink },
  cardDetail: { fontSize: 14, color: theme.inkMuted, marginTop: 2 },
  empty: { fontSize: 14, color: theme.inkMuted },
  error: { fontSize: 16, color: theme.danger, textAlign: "center", paddingHorizontal: 24 },
  errorBanner: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
  },
  primary: { backgroundColor: theme.brand, borderRadius: 999, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  small: { backgroundColor: theme.canvas, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  smallText: { color: theme.brand, fontWeight: "600", fontSize: 14 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
});
