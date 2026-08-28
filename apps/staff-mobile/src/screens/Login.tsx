import { useState } from "react";
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

import { signIn } from "../api";
import * as haptics from "../haptics";
import { theme } from "../theme";

export function Login({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy || password.length === 0) return;
    setBusy(true);
    setError(null);

    const result = await signIn(password);
    setBusy(false);

    if (result.ok) {
      haptics.success();
      onSignedIn(result.data.token);
    } else {
      haptics.error();
      setError(result.error);
      /* Clear on failure so a wrong password is not silently retried, and so a
         tablet left on the login screen is not holding one in a text field. */
      setPassword("");
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Harina Staff</Text>
        <Text style={styles.subtitle}>Sign in to see today's pickups.</Text>

        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Staff password"
          placeholderTextColor={theme.inkSubtle}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          /* The keyboard is up when the app opens. On a shared counter tablet
             this is opened, typed into, and put down dozens of times a shift;
             the tap to focus is pure friction. */
          autoFocus
          returnKeyType="go"
          onSubmitEditing={submit}
          style={styles.input}
          // Announced to screen readers, and it stops the field being generic.
          accessibilityLabel="Staff password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={submit}
onPressIn={haptics.commit}
          disabled={busy || password.length === 0}
          style={({ pressed }) => [
            styles.button,
            (busy || password.length === 0) && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={theme.brandInk} />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas, justifyContent: "center", padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 24, padding: 24, gap: 12 },
  title: { fontSize: 26, fontWeight: "700", color: theme.ink },
  subtitle: { fontSize: 15, color: theme.inkMuted, marginBottom: 8 },
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
  error: { color: theme.danger, fontSize: 14 },
  button: {
    backgroundColor: theme.brand,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: theme.brandInk, fontWeight: "700", fontSize: 16 },
});
