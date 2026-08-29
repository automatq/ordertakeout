import { useCallback, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";

import { createProfile, openSession, requestSignInCode } from "../api";
import { normalizePhoneE164 } from "../phone";
import * as haptics from "../haptics";
import { radius, useTheme } from "../theme";
import { Button, Card } from "../ui/controls";
import { Body, Display, displayScale, Label, Overline } from "../ui/text";
import { compactDisplayLinePull } from "../ui/typography";

/**
 * Sign in with a texted code.
 *
 * A code rather than a magic link: a link has to leave the app, open a mail
 * client and come back, and on a phone that round trip loses people.
 *
 * The screen never says whether a number has an account — that is the server's
 * position and the app must not invent a way around it, so it advances to the
 * code step either way.
 *
 * Answering the code is what splits the two paths, and only then: a known
 * number opens a session, an unknown one asks for a name and an email. Somebody
 * probing numbers never gets that far, because they never receive the text.
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
  const [stage, setStage] = useState<"phone" | "code" | "profile">("phone");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [signup, setSignup] = useState<{ token: string; phone: string } | null>(null);
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
    /* Checked here as well as on the server so an obvious typo answers straight
       away instead of costing a round trip on a bad connection. */
    const parsed = normalizePhoneE164(phone);
    if (!parsed.ok) {
      haptics.error();
      return setMessage(parsed.message);
    }
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
    if (result.data.needsProfile && result.data.signupToken && result.data.phone) {
      haptics.success();
      setSignup({ token: result.data.signupToken, phone: result.data.phone });
      setMessage(null);
      return setStage("profile");
    }
    haptics.error();
    setMessage(result.data.message ?? "That didn't work. Try again.");
    setCode("");
  }, [busy, code, phone, onSignedIn]);

  const submitProfile = useCallback(async () => {
    if (busy || !signup) return;
    if (!name.trim()) return setMessage("Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setMessage("Please enter a valid email address.");
    }

    setBusy(true);
    const result = await createProfile(signup.token, {
      name: name.trim(),
      email: email.trim(),
      phone: signup.phone,
    });
    setBusy(false);

    if (!result.ok) {
      haptics.error();
      return setMessage(result.error);
    }
    haptics.success();
    onSignedIn(result.data.token);
  }, [busy, signup, name, email, onSignedIn]);

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
            <Display size={44} style={{ marginTop: compactDisplayLinePull(44, displayScale(), 0.94) }}>
              order ahead
            </Display>
          </View>
        ) : stage === "code" ? (
          <Display size={38}>Check your texts</Display>
        ) : (
          <Display size={38}>Nice to meet you</Display>
        )}
        <Body size={14.5}>
          {stage === "phone"
            ? "No password. We text you a six-digit code."
            : stage === "code"
              ? "Enter the 6-digit code we sent. It expires in 10 minutes."
              : "Your number is confirmed. Tell us who you are and we'll fill this in every time you order."}
        </Body>

        {stage === "phone" ? <Overline size={11}>Mobile number</Overline> : null}

        {stage === "profile" ? (
          <View style={{ gap: 12 }}>
            <View style={{ gap: 6 }}>
              <Overline size={11}>Name</Overline>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={c.inkSubtle}
                autoComplete="name"
                textContentType="name"
                autoCapitalize="words"
                returnKeyType="next"
                autoFocus
                style={field}
                accessibilityLabel="Your name"
              />
            </View>
            <View style={{ gap: 6 }}>
              <Overline size={11}>Email</Overline>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={c.inkSubtle}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="emailAddress"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={() => void submitProfile()}
                style={field}
                accessibilityLabel="Email address"
              />
              <Body size={12.5} color={c.inkSubtle}>
                Where your confirmation and pickup reminder go.
              </Body>
            </View>
          </View>
        ) : stage === "phone" ? (
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
          label={
            stage === "phone"
              ? "Text me a code"
              : stage === "code"
                ? "Sign in"
                : "Create my account"
          }
          busy={busy}
          onPress={() =>
            void (stage === "phone" ? sendCode() : stage === "code" ? submitCode() : submitProfile())
          }
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
              /* From the profile step the way out is out, not back: the code
                 has been burnt, so the previous screen has nothing left to do. */
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
