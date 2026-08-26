import * as SecureStore from "expo-secure-store";

/**
 * Where the staff token lives.
 *
 * SecureStore rather than AsyncStorage: this token is the whole staff session,
 * and AsyncStorage is a plaintext file that any backup or a rooted device hands
 * over. The Keychain/Keystore is the point.
 *
 * Not yet biometric-gated. The Phase 3 plan calls for
 * `requireAuthentication: true` plus a ten-minute idle auto-lock, because three
 * people share a counter tablet that sits face-up showing customer names, phone
 * numbers and order values. That is the next thing to add here, and it matters
 * more than any screen.
 */

const KEY = "harina.staff.token";

export async function loadToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    /* A Keychain read can fail on a device whose biometric enrolment changed.
       Treat it as signed out rather than crashing on launch. */
    return null;
  }
}

export async function saveToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
