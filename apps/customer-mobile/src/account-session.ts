import * as SecureStore from "expo-secure-store";

import { attempt } from "./nonfatal";

/**
 * The customer's session token.
 *
 * In the Keychain, like the staff app's, and for the same reason: it is the
 * whole session, and AsyncStorage is a plaintext file any backup hands over.
 *
 * Not behind a biometric gate, unlike the staff app. That one guards a screen
 * showing every customer's name, phone number and order value on a device three
 * people share. This one guards your own order history on your own phone, which
 * is already behind the phone's lock screen — asking for Face ID to see what
 * cake you bought would be security theatre with a real cost in friction.
 */

const KEY = "harina.account";

export async function loadAccountToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function saveAccountToken(token: string): Promise<boolean> {
  const result = await attempt("saving account session", () => SecureStore.setItemAsync(KEY, token));
  return result.ok;
}

export async function clearAccountToken(): Promise<boolean> {
  const result = await attempt("clearing account session", () => SecureStore.deleteItemAsync(KEY));
  return result.ok;
}
