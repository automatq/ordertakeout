import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { Locked } from "./src/screens/Locked";
import { Login } from "./src/screens/Login";
import { Queue } from "./src/screens/Queue";
import { Service } from "./src/screens/Service";
import { Scan } from "./src/screens/Scan";
import {
  canUseBiometrics,
  clearToken,
  forgetPreviousInstall,
  hasStoredToken,
  loadToken,
  saveToken,
  type Protection,
} from "./src/session";
import { theme } from "./src/theme";
import { useIdleLock } from "./src/useIdleLock";

/**
 * Four screens, and navigation is a piece of state rather than a router.
 *
 * The Phase 3 plan picks expo-router, and this was the point at which it was
 * meant to go in. It came back out. On Expo SDK 57, expo-router pulls @expo/ui,
 * which pulls react-native-reanimated 4.6, which requires
 * react-native-worklets 0.12 — while the expo-modules-core that ships with the
 * same SDK is written against worklets <=0.10 and fails to compile against 0.12
 * (`no member named 'executeSync'`). Those constraints are mutually exclusive,
 * and pinning around them means fighting Expo's own dependency tree.
 *
 * That is a poor trade for a four-screen staff app. The router's real value —
 * file-based parity with the web App Router, and near-free universal links —
 * is for the customer app, which has magic links and short links to catch.
 * Revisit it there, or here once SDK 57's tree settles.
 *
 * Sign-in and the lock are deliberately not navigable. A locked app should have
 * nowhere to go, and no gesture should be able to land past them.
 */

type Phase =
  | { kind: "restoring" }
  | { kind: "signedOut" }
  /** Token is in the Keychain; the OS has not been asked for it yet. */
  | { kind: "locked"; failed: boolean }
  | { kind: "signedIn"; token: string; protection: Protection };

type Screen = "queue" | "scan" | "service";

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "restoring" });
  const [screen, setScreen] = useState<Screen>("queue");
  /* Bumped when service controls change, so the queue refetches instead of
     showing a state the shop just left. */
  const [revision, setRevision] = useState(0);

  const lock = useCallback(() => {
    /* Dropping the token from memory *is* the lock. Getting it back means asking
       the OS again, which is the biometric prompt — there is no JavaScript
       boolean anywhere in that path to tamper with. */
    setPhase((current) =>
      current.kind === "signedIn" ? { kind: "locked", failed: false } : current,
    );
    // Never come back from a lock straight into a live camera.
    setScreen("queue");
  }, []);

  const touch = useIdleLock(phase.kind === "signedIn", lock);

  const unlock = useCallback(async () => {
    const result = await loadToken();
    if (result.kind === "token") {
      setPhase({ kind: "signedIn", token: result.token, protection: result.protection });
    } else if (result.kind === "locked") {
      setPhase({ kind: "locked", failed: true });
    } else {
      setPhase({ kind: "signedOut" });
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      /* Before anything reads the token: on iOS the Keychain outlives the app,
         so a reinstall would otherwise come back holding the old session. */
      await forgetPreviousInstall();

      /* Nobody has signed in on this handset, so go straight to the password
         rather than showing a lock screen for a session that does not exist. */
      if (!(await hasStoredToken())) {
        if (active) setPhase({ kind: "signedOut" });
        return;
      }

      /* There is a session and the OS is guarding it. Land on the lock screen
         rather than prompting during launch: an unexplained Face ID sheet over a
         blank app is alarming, and cancelling it would leave nothing on screen. */
      if (canUseBiometrics()) {
        if (active) setPhase({ kind: "locked", failed: false });
        return;
      }

      const result = await loadToken();
      if (!active) return;
      setPhase(
        result.kind === "token"
          ? { kind: "signedIn", token: result.token, protection: result.protection }
          : { kind: "signedOut" },
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (token: string) => {
    /* Store before showing the queue: if the write fails, better to find out now
       than after a restart silently asks for the password again. */
    const protection = await saveToken(token);
    setPhase({ kind: "signedIn", token, protection });
    setScreen("queue");
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setPhase({ kind: "signedOut" });
    setScreen("queue");
  }, []);

  return (
    <View
      style={styles.root}
      /* Observes touches without ever claiming them, so the idle clock is reset
         by a person rather than by the queue's own fifteen-second refresh. */
      onStartShouldSetResponderCapture={() => {
        touch();
        return false;
      }}
    >
      <StatusBar style={screen === "scan" && phase.kind === "signedIn" ? "light" : "dark"} />

      {phase.kind === "restoring" ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : phase.kind === "locked" ? (
        <Locked onUnlock={unlock} onSignOut={signOut} failed={phase.failed} />
      ) : phase.kind === "signedIn" ? (
        screen === "scan" ? (
          <Scan token={phase.token} onClose={() => setScreen("queue")} />
        ) : screen === "service" ? (
          <Service
            token={phase.token}
            onClose={() => setScreen("queue")}
            onChanged={() => setRevision((n) => n + 1)}
          />
        ) : (
          <Queue
            key={revision}
            token={phase.token}
            protection={phase.protection}
            onSignedOut={signOut}
            onScan={() => setScreen("scan")}
            onService={() => setScreen("service")}
          />
        )
      ) : (
        <Login onSignedIn={signIn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.canvas },
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
});
