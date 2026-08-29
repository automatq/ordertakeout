import { Platform, Settings } from "react-native";
import * as SecureStore from "expo-secure-store";

/**
 * Where the staff token lives, and what stands between it and a stranger.
 *
 * The token is the whole staff session, so it goes in the Keychain/Keystore
 * rather than AsyncStorage, which is a plaintext file any backup hands over.
 *
 * The gate is `requireAuthentication` on the item itself, not a call to
 * `authenticateAsync()`. That distinction is the entire security value here:
 * `authenticateAsync()` returns a JavaScript boolean, and anyone running a
 * patched bundle can make it return true. `requireAuthentication` makes the
 * operating system refuse to hand the bytes over at all, and there is nothing
 * in JavaScript to patch.
 */

const KEY = "harina.staff.token";
/**
 * A plain, unauthenticated marker saying a token exists.
 *
 * Whether an item is present cannot be checked without reading it, and reading
 * the token is the biometric prompt. Without this, a freshly installed app would
 * have to show a lock screen and prompt for Face ID before it could discover
 * nobody has ever signed in — which implies a session that does not exist.
 *
 * It holds no secret. The only thing it discloses to someone already holding an
 * unlocked handset is that the app has been signed into, which the app icon
 * being there already suggests.
 */
const PRESENT = "harina.staff.token.present";
/** Lives in NSUserDefaults, which — unlike the Keychain — dies with the app. */
const INSTALL_MARKER = "harina.staff.install";

/** What is actually protecting the token on this device. */
export type Protection = "biometric" | "device-only";

const BASE = {
  /* Never leaves this handset: no iCloud Keychain, no restore onto a new
     device from a backup. A staff token should die with the tablet. */
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} as const;

const authenticated = {
  ...BASE,
  requireAuthentication: true,
  requireAuthenticationMessage: "Unlock Harina Staff",
} as const;

/**
 * Whether the OS will actually enforce a biometric gate.
 *
 * False on a handset with no passcode and no enrolled biometric — which is a
 * real state for a shop tablet nobody set up properly, and the reason the app
 * says so on screen instead of quietly storing the token unprotected.
 */
export const canUseBiometrics = (): boolean => SecureStore.canUseBiometricAuthentication();

/** Whether anyone is signed in, answerable without prompting for anything. */
export async function hasStoredToken(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(PRESENT, BASE)) !== null;
  } catch {
    return false;
  }
}

export type LoadResult =
  | { kind: "token"; token: string; protection: Protection }
  /** Something is stored; the OS would not release it. Retryable. */
  | { kind: "locked" }
  /** Nothing stored. Sign in with the password. */
  | { kind: "absent" };

export async function saveToken(token: string): Promise<Protection> {
  await markPresent();

  if (canUseBiometrics()) {
    try {
      await SecureStore.setItemAsync(KEY, token, authenticated);
      return "biometric";
    } catch {
      /* Enrolment can change between the capability check and the write. Falling
         back is better than refusing to sign in at the counter — the app reports
         the weaker level rather than implying a protection it does not have. */
    }
  }

  await SecureStore.setItemAsync(KEY, token, BASE);
  return "device-only";
}

const markPresent = () => SecureStore.setItemAsync(PRESENT, "1", BASE);

/**
 * Read the token back, prompting for Face ID or a passcode if it was stored
 * behind one.
 *
 * A throw here is usually the person cancelling the prompt, but it is also what
 * a newly enrolled fingerprint looks like — iOS invalidates the item and the
 * read fails forever. The two are indistinguishable from here, so both surface
 * as `locked` and the lock screen offers a way back to the password. That way
 * neither case strands anyone.
 */
export async function loadToken(): Promise<LoadResult> {
  try {
    const token = await SecureStore.getItemAsync(KEY, authenticated);
    if (token) return { kind: "token", token, protection: "biometric" };
  } catch {
    return { kind: "locked" };
  }

  /* Stored before biometrics were available, or on a device that has none.
     Read without the flag rather than reporting "absent" and asking for the
     password again on every launch. */
  try {
    const token = await SecureStore.getItemAsync(KEY, BASE);
    return token ? { kind: "token", token, protection: "device-only" } : { kind: "absent" };
  } catch {
    return { kind: "absent" };
  }
}

/**
 * Forget a session left behind by a previous install.
 *
 * iOS keeps Keychain items when an app is deleted. Reinstalling therefore comes
 * back still signed in, which is not what deleting an app means to anyone — and
 * it makes "uninstall it and start again", the universal first move when
 * something is wrong, quietly do nothing.
 *
 * NSUserDefaults *is* wiped on uninstall, so its emptiness is the signal. Android
 * clears app data including the Keystore, so this is an iOS problem only.
 *
 * Deliberately runs before anything reads the token, so a reinstalled app sees a
 * clean slate rather than a lock screen for a session it cannot explain.
 */
export async function forgetPreviousInstall(): Promise<void> {
  if (Platform.OS !== "ios") return;

  if (Settings.get(INSTALL_MARKER)) return;

  await clearToken();
  Settings.set({ [INSTALL_MARKER]: true });
}

export async function clearToken(): Promise<void> {
  /* Both variants: the item may have been written under either set of options,
     and deleting only one leaves a token behind after an apparent sign-out. */
  await Promise.allSettled([
    SecureStore.deleteItemAsync(KEY, authenticated),
    SecureStore.deleteItemAsync(KEY, BASE),
    SecureStore.deleteItemAsync(PRESENT, BASE),
  ]);
}
