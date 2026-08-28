import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";

import { openSession, requestSignInCode } from "../api";
import * as haptics from "../haptics";
import { radius, useTheme } from "../theme";
import { Button, Card } from "../ui/controls";
import { Body, Display, displayScale, Label, Overline } from "../ui/text";

/**
 * Sign in with a texted code.
 *
 * A code rather than a magic link: a link has to leave the app, open a mail
 * client and come back, and on a phone that round trip loses people.
 *
 * The screen never says whether a number has an account — that is the server's
 * position and the app must not invent a way around it, so it advances to the
 * code step either way.
 */
export function SignIn({
  onSignedIn,
  onCancel,
}: {
  onSignedIn: (token: string) => void;
  onCancel: () => void;
}) {
  const { c } = useTheme();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "code">("phone");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const field = {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.control,
    backgroundColor: c.surfaceSunken,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    color: c.ink,
  } as const;

  const sendCode = useCallback(async () => {
    if (busy || !phone.trim()) return;
    setBusy(true);
    const result = await requestSignInCode(phone.trim());
    setBusy(false);
    if (!result.ok) {
      haptics.error();
      return setMessage(result.error);
    }
    setMessage(result.data.message);
    /* Keyed on `sent`, which the route sets from rate limiting and number
       validity — never from whether the number has an account. The buzz
       therefore says no more than the sentence already on screen. */
    if (result.data.sent) {
      haptics.success();
      setStage("code");
    } else {
      haptics.error();
    }
  }, [busy, phone]);

  const submitCode = useCallback(async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    const result = await openSession(phone.trim(), code.trim());
    setBusy(false);
    if (!result.ok) {
      haptics.error();
      return setMessage(result.error);
    }
    if (result.data.signedIn && result.data.token) {
      haptics.success();
      return onSignedIn(result.data.token);
    }
    haptics.error();
    setMessage(result.data.message ?? "That didn't work. Try again.");
    setCode("");
  }, [busy, code, phone, onSignedIn]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, justifyContent: "center", padding: 24 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Card style={{ gap: 12, padding: 24 }}>
        {stage === "phone" ? (
          <View>
            <Display size={44}>Sign in to</Display>
            {/* Same trick as the home headline, and the same Dynamic Type
                caveat: the pull is derived from the size the type will actually
                render at, not from the literal 44. */}
            <Display size={44} style={{ marginTop: 44 * displayScale() * (0.94 - 0.98) }}>
              order ahead
            </Display>
          </View>
        ) : (
          <Display size={38}>Check your texts</Display>
        )}
        <Body size={14.5}>
          {stage === "phone"
            ? "No password. We text you a six-digit code."
            : "Enter the 6-digit code we sent. It expires in 10 minutes."}
        </Body>

        {stage === "phone" ? <Overline size={11}>Mobile number</Overline> : null}

        {stage === "phone" ? (
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="Mobile number"
            placeholderTextColor={c.inkSubtle}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="send"
            onSubmitEditing={() => void sendCode()}
            autoFocus
            style={field}
            accessibilityLabel="Mobile number"
          />
        ) : (
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="6-digit code"
            placeholderTextColor={c.inkSubtle}
            keyboardType="number-pad"
            /* What lets both platforms offer the code from the text as a one-tap
               suggestion above the keyboard. */
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            returnKeyType="go"
            onSubmitEditing={() => void submitCode()}
            autoFocus
            style={[field, { fontSize: 26, letterSpacing: 8, textAlign: "center" }]}
            accessibilityLabel="Six digit code"
          />
        )}

        {message ? (
          <Body size={13.5} color={c.inkMuted}>
            {message}
          </Body>
        ) : null}

        <Button
          label={stage === "phone" ? "Text me a code" : "Sign in"}
          busy={busy}
          onPress={() => void (stage === "phone" ? sendCode() : submitCode())}
        />

        <Pressable
          onPress={() => {
            if (stage === "code") {
              // Back to the number, not out — a typo in a phone number is the
              // most likely reason to be here twice.
              setStage("phone");
              setCode("");
              setMessage(null);
            } else {
              onCancel();
            }
          }}
          onPressIn={haptics.tap}
          hitSlop={8}
        >
          <Label size={15} color={c.brand} style={{ textAlign: "center", paddingVertical: 6 }}>
            {stage === "code" ? "Use a different number" : "Not now"}
          </Label>
        </Pressable>

        <Body size={11.5} color={c.inkSubtle} style={{ paddingTop: 6 }}>
          By continuing you agree to our terms and privacy policy. Message and data rates may apply.
        </Body>
      </Card>
    </KeyboardAvoidingView>
  );
}
