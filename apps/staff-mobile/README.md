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
| Sign in | Password → bearer token, stored in the Keychain |
| Pickup queue | Grouped by day and slot, polls every 15s, pull to refresh |

## What's next, in order

1. **Biometric gate and idle auto-lock.** The token is in SecureStore but not
   behind `requireAuthentication`, and there is no auto-lock. Three people share
   a counter tablet that sits face-up showing customer names, phone numbers and
   order values. This matters more than any new screen.
2. **Per-device revocation.** The token is signed with the shared staff
   password, so a lost handset can only be revoked by rotating it — which signs
   out every tablet mid-shift, which means nobody ever will. Needs the
   `staff_devices` table.
3. **Pickup verification.** The biggest native win: scanning a customer's pass
   with the camera instead of reading an order number aloud.
4. **86 / pause**, then the prep timeline.

expo-router goes in with screen 3. At two screens it would be configuration
without a payoff; navigation is a piece of state in `App.tsx` until then.

## Shared code

None yet, and that is a deliberate holding position rather than an oversight.
The scheduling engine, cart algebra and every zod schema are worth sharing —
about 2,500–3,500 lines of the valuable stuff — but that needs the workspace
move, which cannot land while it would turn an open PR into a 600-file rename
diff. `src/theme.ts` and `src/api.ts` duplicate things the web app already knows
and are the first two files that should stop being copies.
