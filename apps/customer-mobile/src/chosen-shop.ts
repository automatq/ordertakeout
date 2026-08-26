import * as SecureStore from "expo-secure-store";

/**
 * Which shop this person collects from.
 *
 * Remembered because it is the answer to a question nobody wants to be asked
 * twice, and because until it is answered the app cannot tell anybody whether
 * anything is in stock.
 *
 * SecureStore rather than a plain file for one reason: this is a small fact
 * about where somebody physically goes, several times a month. It is not a
 * secret, but it is not nothing either, and the Keychain costs no more to use.
 */

const KEY = "harina.shop";

export async function loadChosenShop(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // Unreadable is the same as unchosen: ask again rather than crash on launch.
    return null;
  }
}

export async function saveChosenShop(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, id);
}

export async function forgetChosenShop(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
