import { useCallback, useState } from "react";
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

import { openSession, requestSignInCode } from "../api";
import { theme } from "../theme";

/**
 * Sign in with a texted code.
 *
 * Chosen over a magic link because a link has to leave the app, open a mail
 * client, and come back — and on a phone that round trip loses people. A code
 * stays in one place, and both platforms offer it as a one-tap keyboard
 * suggestion the moment the text arrives.
 *
 * The screen never says whether a number has an account. That is the server's
 * position and the app must not invent a way around it: "we've sent one if it
 * exists" is shown identically either way, so the code step is always reached.
 */
export function SignIn({
  onSignedIn,
  onCancel,
}: {
  onSignedIn: (token: string) => void;
  onCancel: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = useCallback(async () => {
    if (busy || phone.trim().length === 0) return;
    setBusy(true);
    const result = await requestSignInCode(phone.trim());
    setBusy(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setMessage(result.data.message);
    /* Advance whether or not the number is known — stopping here for an unknown
       one would answer the question the server refuses to. */
    if (result.data.sent) setStage("code");
  }, [busy, phone]);

  const submitCode = useCallback(async () => {
    if (busy || code.trim().length === 0) return;
    setBusy(true);
    const result = await openSession(phone.trim(), code.trim());
    setBusy(false);

    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    if (result.data.signedIn && result.data.token) {
      onSignedIn(result.data.token);
      return;
    }
    setMessage(result.data.message ?? "That didn't work. Try again.");
    setCode("");
  }, [busy, code, phone, onSignedIn]);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>
          {stage === "phone" ? "Sign in" : "Check your texts"}
        </Text>
        <Text style={styles.body}>
          {stage === "phone"
            ? "We'll text you a code. No password to remember."
            : "Enter the 6-digit code we sent."}
        </Text>

        {stage === "phone" ? (
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Mobile number"
            placeholderTextColor={theme.inkSubtle}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
            autoFocus
            style={styles.input}
            accessibilityLabel="Mobile number"
          />
        ) : (
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="6-digit code"
            placeholderTextColor={theme.inkSubtle}
            keyboardType="number-pad"
            /* This is what lets iOS and Android offer the code from the text as
               a one-tap suggestion above the keyboard. */
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={() => void submitCode()}
            autoFocus
            style={[styles.input, styles.codeInput]}
            accessibilityLabel="Six digit code"
          />
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}

        <Pressable
          onPress={() => void (stage === "phone" ? sendCode() : submitCode())}
          disabled={busy}
          style={({ pressed }) => [styles.primary, busy && styles.disabled, pressed && styles.pressed]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryText}>
              {stage === "phone" ? "Text me a code" : "Sign in"}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => {
            if (stage === "code") {
              // Back to the number, not out of the flow — a typo in a phone
              // number is the most likely reason to be on this screen twice.
              setStage("phone");
              setCode("");
              setMessage(null);
            } else {
              onCancel();
            }
          }}
          hitSlop={8}
        >
          <Text style={styles.link}>
            {stage === "code" ? "Use a different number" : "Not now"}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.canvas, justifyContent: "center", padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 24, padding: 24, gap: 12 },
  title: { fontSize: 26, fontWeight: "700", color: theme.ink },
  body: { fontSize: 15, color: theme.inkMuted, lineHeight: 21 },
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
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: "center" },
  message: { fontSize: 14, color: theme.inkMuted, lineHeight: 20 },
  primary: { backgroundColor: theme.brand, borderRadius: 999, paddingVertical: 16, alignItems: "center" },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  link: { color: theme.brand, fontWeight: "600", fontSize: 15, textAlign: "center", paddingVertical: 6 },
});
