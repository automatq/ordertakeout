# Gate 0 spike — Square In-App Payments on the New Architecture

The Phase 3 plan puts one thing ahead of everything else: find out whether Square's
React Native payment SDK actually works on the architecture React Native now ships
by default. If it doesn't, the customer app cannot take a payment, and the whole
phase changes shape. This directory answers that question.

It is deliberately standalone — its own `package.json`, its own `node_modules`,
no dependency on the web app. Nothing here is imported by the Next.js project,
and deleting the directory has no effect on it.

## What the plan assumed, and what is actually true

The plan was written from the package's public documentation. Reading the
published artefact tells a different and much better story.

| The plan's assumption | What `2.1.1` (published 2026-08-18) actually ships |
|---|---|
| No documented Fabric/TurboModule support | `codegenConfig` with a `SquareInAppPaymentsSpec`, and `NativeSQIPCardEntry.d.ts` declares `interface Spec extends TurboModule` |
| Kotlin 2.1 vs Square's 2.2.21 needs manual Gradle work | The Expo config plugin pins `kotlin-gradle-plugin:2.2.21` itself — verified in the generated `android/build.gradle` |
| Build a throwaway app to test the flow | Square ships an official `example-expo` app in its own repo |
| `completeCardEntry()` / `showCardNonceProcessingError()` | **Both deprecated.** See below — this one changes app code, not just the spike |

### The API change worth reading twice

The plan's checklist tested this sequence:

```ts
startCardEntryFlow(config, onNonce, onCancel)   // then, imperatively:
completeCardEntry()                             // ...or...
showCardNonceProcessingError("Declined")
```

All three of those are now deprecated. The current flow is a single async
callback that returns a result:

```ts
SQIPCardEntry.startCardEntryFlow(
  true,                                  // collectPostalCode
  async (cardDetails) => {
    const res = await payOnServer(cardDetails.nonce);   // cnon: token
    return res.ok
      ? { success: true }                                // sheet dismisses
      : { success: false, errorMessage: res.message };   // error renders IN the sheet
  },
  () => { /* cancelled */ },
);
```

This is a straight improvement for Harina. `payForOrder` is a server call that
can fail after the card is entered, and the old imperative pair made "show the
decline without losing the customer's typed card" a manual dance across two
callbacks. Now it is the return value.

## What has already been answered, without a device

Run from this directory. Each of these was executed and passed:

| Check | Command | Result |
|---|---|---|
| Dependencies resolve on Expo SDK 57 | `npm install` | 531 packages, no peer conflicts |
| Config plugin survives prebuild | `npx expo prebuild --clean --no-install` | Clean, no warnings |
| ...and is idempotent | run it twice | Clean both times |
| Kotlin pin applied automatically | `grep kotlin android/build.gradle` | `kotlin-gradle-plugin:2.2.21` |
| New Architecture enabled | `grep newArchEnabled android/gradle.properties` | `newArchEnabled=true` |
| Square maven repo injected | `grep square android/build.gradle` | `sdk.squareup.com/public/android` |
| Metro bundles the module graph | `npm run bundle` | 909 modules → 1.8MB `.hbc` |
| Date fixtures are correct | `npx tsx -e '…runIntlChecks()'` | 12/12 on Node/V8 |

### One thing that got worse, not better

`react-native-square-in-app-payments` depends on `@expo/config-plugins: ^8.0.0`,
while Expo SDK 57 ships `57.0.9`. Both end up installed:

```
node_modules/@expo/config-plugins                                    57.0.9
node_modules/react-native-square-in-app-payments/node_modules/…       8.0.11
```

Prebuild survives it (verified above), but the old copy drags in
`@xmldom/xmldom@0.7.13`, which npm flags as having critical issues. It is a
build-time dependency only — it does not reach the shipped bundle — but it is
worth an upstream issue, and worth re-checking on every plugin upgrade.

## What still needs hardware or a credential

1. **A Square sandbox application ID.** `.env.local` in the web app currently
   holds the placeholder `demo-not-use`. Put a real sandbox ID in `.env` here as
   `EXPO_PUBLIC_SQUARE_APPLICATION_ID=…` and the three card-entry checks light up.
   Until then the app says so rather than pretending.
2. **A release build.** Legacy interop most often diverges between debug and
   release; a debug pass proves less than it looks like it does. The app prints a
   caveat banner when it is running in debug.
3. **A physical low-end Android device** for the Hermes date checks. The iOS
   simulator runs the same Hermes that ships, so it answers the iOS half; Android
   Hermes takes its timezone data from the platform's ICU, which varies by OEM and
   API level. That is exactly the case worth testing on the cheapest handset you
   can find.

## Running it

```bash
cd spike/square-newarch
npm install
npx expo prebuild --clean          # regenerate ios/ and android/

# Debug, to check it comes up at all:
npx expo run:ios
npx expo run:android

# Release, which is the run that counts:
npx expo run:ios --configuration Release
npx expo run:android --variant release
```

`ios/` and `android/` are gitignored on purpose — they are outputs of
`expo prebuild`, and committing them is how a project quietly loses the ability
to upgrade Expo.

## Pass criteria

The spike passes when, **in a release build with Fabric and bridgeless both
reporting yes**:

- [ ] All date checks pass on iOS and on a low-end Android device
- [ ] The card sheet presents
- [ ] A sandbox card returns a token beginning `cnon:`
- [ ] Returning `{ success: false, errorMessage }` shows the message and does not
      throw the customer's card away
- [ ] Returning `{ success: true }` dismisses the sheet
- [ ] 20 open/cancel cycles complete without a crash or a stuck presentation

If the date checks fail, ship `@formatjs/intl-datetimeformat` with timezone data
(~200KB) before writing any scheduling code. If the card sheet fails, the
fallback order from the plan still stands: legacy interop → pinned SDK with
`newArchEnabled: false` → card entry in a WebView reusing the working web payment
form → card entry on web only, with card-on-file in the app.
