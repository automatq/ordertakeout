import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { theme } from "../theme";

/**
 * Shown when the idle timer fires, or when the OS refuses to release the token.
 *
 * The way back is deliberately two doors. Unlock covers the ordinary case —
 * somebody put the tablet down. "Use the password instead" covers the one that
 * would otherwise strand a shop: enrolling a new fingerprint invalidates the
 * stored item permanently, and from here that is indistinguishable from a
 * cancelled prompt. Without the second door, a tablet in that state could never
 * be signed into again.
 */
export function Locked({
  onUnlock,
  onSignOut,
  failed,
}: {
  onUnlock: () => Promise<void>;
  onSignOut: () => void;
  failed: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function unlock() {
    setBusy(true);
    await onUnlock();
    setBusy(false);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Locked</Text>
        <Text style={styles.body}>
          {failed
            ? "That didn't unlock it. If you've recently changed Face ID or your fingerprint, sign in with the password again."
            : "Unlock to see today's pickups."}
        </Text>

        <Pressable
          onPress={unlock}
          disabled={busy}
          style={({ pressed }) => [styles.button, busy && styles.disabled, pressed && styles.pressed]}
        >
          {busy ? <ActivityIndicator color={theme.brandInk} /> : <Text style={styles.buttonText}>Unlock</Text>}
        </Pressable>

        <Pressable onPress={onSignOut} hitSlop={8}>
          <Text style={styles.secondary}>Use the password instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas, justifyContent: "center", padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 24, padding: 24, gap: 12, alignItems: "center" },
  title: { fontSize: 24, fontWeight: "700", color: theme.ink },
  body: { fontSize: 15, color: theme.inkMuted, textAlign: "center", lineHeight: 21 },
  button: {
    backgroundColor: theme.brand,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    alignSelf: "stretch",
    marginTop: 4,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  buttonText: { color: theme.brandInk, fontWeight: "700", fontSize: 16 },
  secondary: { color: theme.brand, fontWeight: "600", fontSize: 15, paddingVertical: 8 },
});
