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
| Scanner | Camera or typed order number → check the name → hand over |

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

## The scanner

Two steps, deliberately. The scan finds the order; a person still reads the name
back before anything is marked collected. Going straight from a good scan to
"collected" would make the pass alone enough to take somebody else's order, and
passes get forwarded, screenshotted and left open on shared phones.

The scanned string crosses the wire exactly as it came off the QR code. Parsing
and signature checking stay on the server, so a patched build cannot talk its way
past them — verified against a real pass with one character of the signature
changed, and against a valid signature moved onto a different order number. Both
are refused, because the signature covers the order id.

Manual entry sits *beside* the camera rather than behind a failure. A floury
lens, a cracked screen, a flat battery — none of those are exceptional at a
bakery counter, and making staff fail twice before offering the keyboard is its
own kind of rudeness. There is a torch toggle for the same reason.

## Why there is no router

The Phase 3 plan picks expo-router, and this was the point it was meant to go in.
It came back out.

On Expo SDK 57, `expo-router` pulls `@expo/ui` → `react-native-reanimated@4.6`,
which requires `react-native-worklets@0.12`. The `expo-modules-core` that ships
with the *same SDK* is written against worklets ≤0.10 and fails to compile
against 0.12 (`no member named 'executeSync'`). Those constraints are mutually
exclusive; pinning around them means fighting Expo's own dependency tree.

For four screens that is a bad trade. The router's real value — file-based parity
with the web App Router, and near-free universal links — is for the customer app,
which has magic links and short links to catch. Revisit it there, or here once
SDK 57's tree settles.

## What's next, in order

1. **86 / pause**, then the prep timeline.
2. **Haptics on a successful scan.** A counter is loud and staff are not looking
   at the screen while they reach for a box.

expo-router goes in with pickup verification. At two screens it would be configuration
without a payoff; navigation is a piece of state in `App.tsx` until then.

## Shared code

None yet, and that is a deliberate holding position rather than an oversight.
The scheduling engine, cart algebra and every zod schema are worth sharing —
about 2,500–3,500 lines of the valuable stuff — but that needs the workspace
move, which cannot land while it would turn an open PR into a 600-file rename
diff. `src/theme.ts` and `src/api.ts` duplicate things the web app already knows
and are the first two files that should stop being copies.
