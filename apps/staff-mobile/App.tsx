import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";

import { Login } from "./src/screens/Login";
import { Queue } from "./src/screens/Queue";
import { clearToken, loadToken, saveToken } from "./src/session";
import { theme } from "./src/theme";

/**
 * Two screens, so navigation is a piece of state rather than a router.
 *
 * The Phase 3 plan picks expo-router for file-based parity with the web App
 * Router, and that earns its keep once there are pickup verification, the prep
 * timeline and 86/pause to move between. At two screens it would be config
 * without a payoff, so it goes in when the third screen does.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    void loadToken().then((stored) => {
      if (!active) return;
      setToken(stored);
      setRestoring(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (next: string) => {
    /* Store before showing the queue: if the write fails, better to find out now
       than to have the tablet silently ask for the password again after every
       restart. */
    await saveToken(next);
    setToken(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setToken(null);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {restoring ? (
        <View style={styles.centre}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : token ? (
        <Queue token={token} onSignedOut={signOut} />
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
