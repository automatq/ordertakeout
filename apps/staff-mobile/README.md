# Harina Staff

The counter app. Its job is the twenty minutes around a pickup — see who is
coming, what they ordered, and whether it has been handed over.

Deliberately not everything the web dashboard does. Sales analytics, the 1,540
lines of settings forms, the print sheet and the audit log stay on a keyboard;
putting them on a 6" screen is worse than the web view and would cost weeks for
roughly zero operator value.

## Running it

The app talks to the Next.js app's `/api/v1` routes.

```bash
npm install
npx expo prebuild --clean
npx expo run:ios          # or run:android
```

By default it points at `http://localhost:3000`, which the iOS Simulator
resolves to your machine. A real handset cannot — it needs an address on the
same network, or the deployed site:

```bash
# .env
EXPO_PUBLIC_API_URL=http://192.168.1.42:3000
```

Cleartext to a LAN address works because the generated Info.plist sets
`NSAllowsLocalNetworking`. `NSAllowsArbitraryLoads` stays false, so a production
build must talk HTTPS — which the deployed site does anyway.

## What's here

| Screen | State |
|---|---|
| Sign in | Password → bearer token |
| Locked | Face ID / Touch ID / passcode, with a way back to the password |
| Pickup queue | Grouped by day and slot, polls every 15s, pull to refresh |

## The lock

The token is stored with `requireAuthentication`, not guarded by a call to
`authenticateAsync()`. The difference is the whole security value:
`authenticateAsync()` returns a JavaScript boolean, and anyone running a patched
bundle can make it return `true`. `requireAuthentication` makes the OS refuse to
release the bytes, and there is no boolean in that path to patch.

Locking is therefore just dropping the token from memory. Getting it back means
asking the OS again, which *is* the prompt.

It locks after ten idle minutes, where idle means no touches — the queue
refreshes itself every fifteen seconds, so anything keyed on network activity
would hold the session open forever. Backgrounded time is measured by wall clock
rather than a timer, because timers do not run reliably while suspended and a
tablet shut in a drawer overnight would otherwise come back unlocked.

Set `EXPO_PUBLIC_LOCK_MINUTES` to watch it happen without waiting ten minutes.

Two failure modes are handled because they would otherwise strand a shop:

- **A newly enrolled fingerprint invalidates the stored item permanently.** From
  JavaScript that is indistinguishable from someone cancelling the prompt, so
  both land on the lock screen and it offers "Use the password instead".
- **A handset with no passcode or biometric** cannot enforce any of this. The
  app stores the token at the weaker level and says so on a permanent red strip,
  rather than implying a protection it does not have.
- **iOS keeps Keychain items when an app is deleted.** A reinstall would
  otherwise come back still signed in — which is not what deleting an app means
  to anyone, and it makes "uninstall it and try again" quietly do nothing.
  NSUserDefaults *is* wiped, so its emptiness is the signal to clear the
  Keychain first. Android removes app data on uninstall, so this is iOS only.
  Found by uninstalling during testing and getting a lock screen instead of a
  sign-in screen.

## Revocation

Signing in registers a row in `staff_devices` with its own secret, and the token
is signed with that rather than the shared password. Revoking the row from
**Settings → Devices** on the web dashboard stops exactly that handset,
immediately, and touches nothing else — no other tablet signs out and the shared
password never changes.

The label comes from `Device.deviceName`, because "iPhone" three times over
makes the revoke decision impossible and "Ana's iPhone" makes it obvious.

Signing in twice on one tablet makes two rows. That is the honest record: the
first token is still live until somebody revokes it.

Tokens last thirty days rather than the web session's twelve hours. A tablet
that asks for the password every morning gets the password written on a sticky
note beside it. The long life is only defensible *because* revocation exists —
the answer to a lost device is to revoke it, not to hope it expires.

## What's next, in order

1. **Pickup verification.** The biggest native win: scanning a customer's pass
   with the camera instead of reading an order number aloud.
2. **86 / pause**, then the prep timeline.

expo-router goes in with pickup verification. At two screens it would be configuration
without a payoff; navigation is a piece of state in `App.tsx` until then.

## Shared code

None yet, and that is a deliberate holding position rather than an oversight.
The scheduling engine, cart algebra and every zod schema are worth sharing —
about 2,500–3,500 lines of the valuable stuff — but that needs the workspace
move, which cannot land while it would turn an open PR into a 600-file rename
diff. `src/theme.ts` and `src/api.ts` duplicate things the web app already knows
and are the first two files that should stop being copies.
