import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { Locked } from "./src/screens/Locked";
import { Login } from "./src/screens/Login";
import { Queue } from "./src/screens/Queue";
import {
  canUseBiometrics,
  clearToken,
  hasStoredToken,
  loadToken,
  saveToken,
  type Protection,
} from "./src/session";
import { theme } from "./src/theme";
import { useIdleLock } from "./src/useIdleLock";

/**
 * Two screens and a lock, so navigation is a piece of state rather than a router.
 *
 * The Phase 3 plan picks expo-router for file-based parity with the web App
 * Router, and that earns its keep once there are pickup verification, the prep
 * timeline and 86/pause to move between. It goes in with the third screen.
 */

type Phase =
  | { kind: "restoring" }
  | { kind: "signedOut" }
  /** Token is in the Keychain; the OS has not been asked for it yet. */
  | { kind: "locked"; failed: boolean }
  | { kind: "signedIn"; token: string; protection: Protection };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "restoring" });

  const lock = useCallback(() => {
    /* Dropping the token from memory *is* the lock. Getting it back means
       asking the OS again, which is the biometric prompt — there is no
       JavaScript boolean anywhere in that path to tamper with. */
    setPhase((current) => (current.kind === "signedIn" ? { kind: "locked", failed: false } : current));
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
      /* Nobody has signed in on this handset, so go straight to the password
         rather than showing a lock screen for a session that does not exist. */
      if (!(await hasStoredToken())) {
        if (active) setPhase({ kind: "signedOut" });
        return;
      }

      /* There is a session, and the OS is guarding it. Land on the lock screen
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
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setPhase({ kind: "signedOut" });
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
      <StatusBar style="dark" />
      {phase.kind === "restoring" ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : phase.kind === "locked" ? (
        <Locked onUnlock={unlock} onSignOut={signOut} failed={phase.failed} />
      ) : phase.kind === "signedIn" ? (
        <Queue token={phase.token} protection={phase.protection} onSignedOut={signOut} />
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
