import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";

import { confirmPickup, previewPickup, type PickupPreview } from "../api";
import { formatDate, formatTime } from "../format";
import * as haptics from "../haptics";
import { theme } from "../theme";

/**
 * Scan a customer's pickup pass and hand the order over.
 *
 * Two steps, deliberately. The scan finds the order; a person still reads the
 * name back before anything is marked collected. Skipping straight from a
 * successful scan to "collected" would make the pass alone sufficient to take
 * someone else's order, and passes get forwarded, screenshotted and left open on
 * shared phones.
 *
 * Manual entry sits alongside the camera rather than behind a failure. The lens
 * gets covered in flour, the customer's screen is cracked, the battery is dead —
 * none of those are exceptional at a bakery counter, and making staff fail
 * twice before offering the keyboard is its own kind of rudeness.
 */

type Stage =
  | { kind: "scanning" }
  | { kind: "looking-up" }
  | { kind: "found"; order: PickupPreview; today: string; method: "qr" | "manual"; value: string }
  | { kind: "confirming"; order: PickupPreview }
  | { kind: "done"; orderNumber: string; customerName: string; warning?: string }
  | { kind: "refused"; reason: string };

export function Scan({ token, onClose }: { token: string; onClose: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();

  const [stage, setStage] = useState<Stage>({ kind: "scanning" });
  const [initials, setInitials] = useState("");
  const [manual, setManual] = useState("");
  const [torch, setTorch] = useState(false);

  /* The camera fires this many times a second while a code is in frame. Without
     a latch the same pass would be looked up dozens of times. */
  const busy = useRef(false);

  const lookUp = useCallback(
    async (method: "qr" | "manual", value: string) => {
      if (busy.current) return;
      busy.current = true;
      /* After the guard, never in `onBarcodeScanned` — that fires many times a
         second while the code is in frame, and the point of this buzz is "you
         can lower the phone now", said exactly once. */
      haptics.select();
      setStage({ kind: "looking-up" });

      const result = await previewPickup(token, method, value);
      busy.current = false;

      if (!result.ok) {
        haptics.error();
        setStage({ kind: "refused", reason: result.error });
        return;
      }
      if (result.data.found) {
        haptics.tap();
        setStage({ kind: "found", order: result.data.order, today: result.data.today, method, value });
      } else {
        haptics.error();
        setStage({ kind: "refused", reason: result.data.reason });
      }
    },
    [token],
  );

  const confirm = useCallback(async () => {
    if (stage.kind !== "found") return;
    const trimmed = initials.trim();
    if (!trimmed) return;

    const { order, method, value } = stage;
    setStage({ kind: "confirming", order });

    const result = await confirmPickup(token, method, value, trimmed);
    if (!result.ok) {
      haptics.error();
      setStage({ kind: "refused", reason: result.error });
      return;
    }
    if (result.data.verified) {
      /* Warning, not success, when Square did not take it: the customer still
         gets their trays, so this is not a refusal, but it is not a clean
         handover either and the buzz is the only part anyone will notice. */
      if (result.data.squareWarning) haptics.warning();
      else haptics.success();
      setStage({
        kind: "done",
        orderNumber: result.data.orderNumber,
        customerName: order.customerName,
        warning: result.data.squareWarning,
      });
    } else {
      haptics.error();
      setStage({ kind: "refused", reason: result.data.reason });
    }
  }, [stage, initials, token]);

  const reset = useCallback(() => {
    busy.current = false;
    setManual("");
    setStage({ kind: "scanning" });
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {stage.kind === "scanning" ? (
        <Camera
          granted={permission?.granted ?? false}
          canAsk={permission?.canAskAgain ?? true}
          onRequest={requestPermission}
          torch={torch}
          onToggleTorch={() => setTorch((on) => !on)}
          onScanned={(value) => void lookUp("qr", value)}
        />
      ) : (
        <View style={styles.centre}>
          {stage.kind === "looking-up" || stage.kind === "confirming" ? (
            <ActivityIndicator color={theme.brand} size="large" />
          ) : stage.kind === "found" ? (
            <FoundCard
              order={stage.order}
              today={stage.today}
              initials={initials}
              onInitials={setInitials}
              onConfirm={() => void confirm()}
              onCancel={reset}
            />
          ) : stage.kind === "done" ? (
            <DoneCard
              orderNumber={stage.orderNumber}
              customerName={stage.customerName}
              warning={stage.warning}
              onNext={reset}
              onFinish={onClose}
            />
          ) : (
            <RefusedCard reason={stage.reason} onRetry={reset} />
          )}
        </View>
      )}

      {stage.kind === "scanning" ? (
        <View style={styles.tray}>
          <Text style={styles.trayLabel}>Or type the order number</Text>
          <View style={styles.trayRow}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="PT-XXXXXX"
              placeholderTextColor={theme.inkSubtle}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => manual.trim() && void lookUp("manual", manual.trim())}
              style={styles.trayInput}
            />
            <Pressable
              onPress={() => manual.trim() && void lookUp("manual", manual.trim())}
onPressIn={haptics.commit}
              disabled={!manual.trim()}
              style={({ pressed }) => [
                styles.trayButton,
                !manual.trim() && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.trayButtonText}>Find</Text>
            </Pressable>
          </View>
          <Pressable onPress={onClose} hitSlop={12} onPressIn={haptics.tap}>
            <Text style={styles.close}>Back to pickups</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

function Camera({
  granted,
  canAsk,
  onRequest,
  torch,
  onToggleTorch,
  onScanned,
}: {
  granted: boolean;
  canAsk: boolean;
  onRequest: () => void;
  torch: boolean;
  onToggleTorch: () => void;
  onScanned: (value: string) => void;
}) {
  if (!granted) {
    return (
      <View style={styles.centre}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Camera access</Text>
          <Text style={styles.cardBody}>
            {canAsk
              ? "The scanner needs the camera to read pickup passes. Order numbers can still be typed in below."
              : "Camera access is turned off for this app in Settings. Order numbers can still be typed in below."}
          </Text>
          {canAsk ? (
            <Pressable onPress={onRequest} style={styles.primary} onPressIn={haptics.commit}>
              <Text style={styles.primaryText}>Allow camera</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.cameraWrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        // Only QR: every other symbology is a false positive waiting to happen.
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={(result) => onScanned(result.data)}
      />
      <View style={styles.reticle} pointerEvents="none" />
      <Text style={styles.cameraHint}>Point at the customer's pickup pass</Text>
      <Pressable
        onPress={onToggleTorch}
onPressIn={haptics.select}
        style={({ pressed }) => [styles.torch, pressed && styles.pressed]}
      >
        <Text style={styles.torchText}>{torch ? "Light off" : "Light on"}</Text>
      </Pressable>
    </View>
  );
}

function FoundCard({
  order,
  today,
  initials,
  onInitials,
  onConfirm,
  onCancel,
}: {
  order: PickupPreview;
  /* The store's today, so a tablet with a wrong clock cannot label a pickup
     "Today" that is not. */
  today: string;
  initials: string;
  onInitials: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>Check the name before handing it over</Text>
      {/* The largest thing on screen, because reading it aloud is the check. */}
      <Text style={styles.customer}>{order.customerName}</Text>
      <Text style={styles.cardBody}>
        {order.orderNumber} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
        {"\n"}
        {formatDate(order.pickupDate, today)} at {formatTime(order.pickupTime)}
        {order.pickupLocationName ? `\n${order.pickupLocationName}` : ""}
      </Text>

      <TextInput
        value={initials}
        onChangeText={onInitials}
        placeholder="Your initials"
        placeholderTextColor={theme.inkSubtle}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={12}
        style={styles.input}
        accessibilityLabel="Your initials"
      />

      <Pressable
        onPress={onConfirm}
        onPressIn={haptics.commit}
        accessibilityRole="button"
        accessibilityLabel="Confirm this order has been handed over"
        disabled={!initials.trim()}
        style={({ pressed }) => [
          styles.primary,
          !initials.trim() && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.primaryText}>Handed over</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel pickup verification" onPress={onCancel} hitSlop={8} onPressIn={haptics.tap} style={styles.secondaryButton}>
        <Text style={styles.secondary}>Not this one</Text>
      </Pressable>
    </View>
  );
}

function DoneCard({
  orderNumber,
  customerName,
  warning,
  onNext,
  onFinish,
}: {
  orderNumber: string;
  customerName: string;
  warning?: string;
  onNext: () => void;
  onFinish: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.done}>Collected</Text>
      <Text style={styles.cardBody}>
        {customerName} · {orderNumber}
      </Text>
      {/* The order is handed over either way, so staff have to know the books
          will disagree until Square catches up. */}
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
      <Pressable onPress={onNext} style={styles.primary} onPressIn={haptics.commit}>
        <Text style={styles.primaryText}>Scan the next one</Text>
      </Pressable>
      <Pressable onPress={onFinish} hitSlop={8} onPressIn={haptics.tap}>
        <Text style={styles.secondary}>Back to pickups</Text>
      </Pressable>
    </View>
  );
}

function RefusedCard({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.refused}>Can't hand this over</Text>
      <Text style={styles.cardBody}>{reason}</Text>
      <Pressable onPress={onRetry} style={styles.primary} onPressIn={haptics.commit}>
        <Text style={styles.primaryText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas },
  /* Black, and deliberately not a token: this is the void behind a camera
     feed, not a surface, and it must stay black through any rebrand. */
  cameraWrap: { flex: 1, backgroundColor: "#000" },
  reticle: {
    position: "absolute",
    top: "28%",
    left: "12%",
    right: "12%",
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.9)",
    borderRadius: 28,
  },
  cameraHint: {
    position: "absolute",
    top: "18%",
    alignSelf: "center",
    /* Over live video, chosen for contrast against whatever is in frame rather
       than from the palette. */
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  torch: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  /* White over live video, chosen for contrast against whatever is in frame
     rather than from the palette. */
  torchText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  centre: { flex: 1, justifyContent: "center", padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 24, padding: 24, gap: 12 },
  cardLabel: {
    color: theme.inkSubtle,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  cardTitle: { fontSize: 22, fontWeight: "700", color: theme.ink },
  customer: { fontSize: 30, fontWeight: "700", color: theme.ink },
  cardBody: { fontSize: 15, color: theme.inkMuted, lineHeight: 22 },
  done: { fontSize: 26, fontWeight: "700", color: theme.ok },
  refused: { fontSize: 22, fontWeight: "700", color: theme.danger },
  warning: {
    backgroundColor: theme.warnSurface,
    color: theme.warn,
    padding: 12,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: theme.ink,
    backgroundColor: theme.canvas,
  },
  primary: {
    backgroundColor: theme.brand,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryText: { color: theme.brandInk, fontWeight: "700", fontSize: 16 },
  secondaryButton: { minHeight: 44, justifyContent: "center" },
  secondary: { color: theme.brand, fontWeight: "600", fontSize: 15, textAlign: "center" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  tray: { backgroundColor: theme.canvas, padding: 20, gap: 10 },
  trayLabel: { color: theme.inkMuted, fontSize: 14 },
  trayRow: { flexDirection: "row", gap: 10 },
  trayInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: theme.ink,
    backgroundColor: theme.surface,
  },
  trayButton: {
    backgroundColor: theme.brand,
    borderRadius: 14,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  trayButtonText: { color: theme.brandInk, fontWeight: "700", fontSize: 16 },
  close: { color: theme.brand, fontWeight: "600", fontSize: 15, textAlign: "center", paddingVertical: 8 },
});
