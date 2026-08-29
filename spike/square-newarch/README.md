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

## What has already been answered

All of the following was run here, on an iPhone 17 simulator, in a **Release**
build reporting Fabric `yes`, bridgeless `yes`, TurboModules `yes`, Hermes
250829098.0.16, React Native 0.86.2, iOS 26.3.1.

| Check | How | Result |
|---|---|---|
| Dependencies resolve on Expo SDK 57 | `npm install` | 531 packages, no peer conflicts |
| Config plugin survives prebuild | `npx expo prebuild --clean` | Clean, and idempotent across two runs |
| Kotlin pin applied automatically | `grep kotlin android/build.gradle` | `kotlin-gradle-plugin:2.2.21` |
| New Architecture enabled | `grep newArchEnabled android/gradle.properties` | `newArchEnabled=true` |
| Square maven repo injected | `grep square android/build.gradle` | `sdk.squareup.com/public/android` |
| Metro bundles the graph | `npm run bundle` | 909 modules → 1.8MB `.hbc` |
| Codegen builds the TurboModule spec | iOS build log | `SquareInAppPaymentsSpec-generated.mm` compiled |
| Square iOS SDK has a simulator slice | `ls …xcframework` | `ios-arm64_x86_64-simulator` |
| Release build links and runs | `expo run:ios --configuration Release` | Launches (see the framework bug below) |
| **Hermes gets dates right** | on-device checks | **12/12**, in a release build |

The date result is the one that mattered most. `lib/scheduling/time.ts` computes
every cutoff, lead time and pickup date through `Intl.DateTimeFormat` with an
explicit `timeZone`, and Hermes carries no timezone database of its own. On iOS
it defers to Foundation, and Foundation gets all twelve right — both DST
transitions, the ambiguous 1:30am that happens twice on fall-back day, and
Chatham's 45-minute offset. **No `@formatjs/intl-datetimeformat` polyfill is
needed on iOS.** Android still has to be checked; see below.

## The bug worth knowing about: Square's own setup phase runs too early

A release build links and installs cleanly, then dies at launch before any
JavaScript runs:

```
dyld: Library not loaded: @rpath/CorePaymentCard.framework/CorePaymentCard
  Referenced from: .../SquareBuyerVerificationSDK.framework/SquareBuyerVerificationSDK
```

`CorePaymentCard` and `ThreeDS_SDK` are not published pods — `pod trunk` has no
record of either, and Square's `Package.swift` does not vend them. They are only
ever delivered *inside* Square's own frameworks:

```
SquareInAppPaymentsSDK.framework/Frameworks/CorePaymentCard.framework
SquareBuyerVerificationSDK.framework/Frameworks/ThreeDS_SDK.framework
```

Both Square binaries link `@rpath/CorePaymentCard…`, and dyld resolves `@rpath`
from the binary doing the loading. The payments SDK finds it — that is its own
nested directory. The buyer verification SDK does not: `CorePaymentCard` is
nested under its *sibling*, so `@loader_path/Frameworks` misses it.

### Square knows about this. Their fix does not run.

Square ships a `setup` script inside the framework that does exactly the right
thing — moves nested frameworks up into the app's `Frameworks` directory — and
their Expo config plugin adds a `[CP] Square In-App Payments SDK Setup` phase to
run it. It silently does nothing, and the build log says why:

```
› Executing HarinaSquareSpike » [CP] Copy Pods Resources
› Executing HarinaSquareSpike » [CP] Square In-App Payments SDK Setup
› Executing HarinaSquareSpike » [CP] Embed Pods Frameworks
```

The setup phase runs *immediately before* the phase that copies the frameworks
in. It looks in an empty directory, finds nothing to flatten, exits 0, and the
build reports success.

This is structural, not a slip. An Expo config plugin writes the pbxproj during
`prebuild`; CocoaPods appends `[CP] Embed Pods Frameworks` later. **Any phase
added by a config plugin necessarily lands in front of it.** A plugin cannot fix
this from `withXcodeProject` alone — which is why the first attempt at
`plugins/with-flattened-square-frameworks.js` failed in exactly the way Square's
does.

`post_install` is too early as well, which is the less obvious part. CocoaPods
runs the Podfile's post_install hooks and only *then* integrates the user
project, so the embed phase does not exist yet when they fire. Re-appending the
phase there does move it — and changes nothing, because the embed phase is added
afterwards. Both of these were confirmed by reading the phase order out of a
real build log rather than reasoned about.

`post_integrate` runs after integration and is the first point where the embed
phase is present to be ordered against. The plugin appends a hook there that
moves the flatten phase to the end of the target's build phases. It also
re-signs what it copies, since copying invalidates the signature and device and
distribution builds will not launch otherwise.

The flattening is written against "nested frameworks" in general rather than
these two names, so a third Square dependency does not silently reintroduce the
crash.

This is worth reporting upstream. It is not New-Architecture-specific and not
specific to our setup — it should affect any Expo app using
`react-native-square-in-app-payments` that embeds the buyer verification SDK.

### The other packaging wart

`react-native-square-in-app-payments` depends on `@expo/config-plugins: ^8.0.0`,
while Expo SDK 57 ships `57.0.9`. Both end up installed:

```
node_modules/@expo/config-plugins                                    57.0.9
node_modules/react-native-square-in-app-payments/node_modules/…       8.0.11
```

Prebuild survives it, but the old copy drags in `@xmldom/xmldom@0.7.13`, which
npm flags as having critical issues. Build-time only — it does not reach the
shipped bundle — but it belongs in the same upstream issue, and wants a re-check
on every plugin upgrade.

## What still needs hardware or a credential

1. **A Square sandbox application ID.** `.env.local` in the web app currently
   holds the placeholder `demo-not-use`. Put a real sandbox ID in `.env` here as
   `EXPO_PUBLIC_SQUARE_APPLICATION_ID=…` and the three card-entry checks light up.
   Until then the app says so rather than pretending.
2. **A release build.** Legacy interop most often diverges between debug and
   release; a debug pass proves less than it looks like it does. The app prints a
   caveat banner when it is running in debug.
3. **A physical low-end Android device** for the Hermes date checks. Hermes does
   not carry its own timezone database — on iOS it defers to Foundation, on
   Android to the platform's ICU. So the answer is a property of the *host*, not
   of Hermes, and it varies by OS version, OEM and API level.

   The iOS simulator is a strong signal but not the final word: it runs the same
   Hermes build, against macOS's Foundation rather than the device's. Android is
   where the variance actually lives, and the cheapest handset you can find is
   the right thing to test on.

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
