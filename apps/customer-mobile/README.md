# Harina Bakeshoppe

The customer app. Order ahead, collect in store.

## What's here, and what deliberately is not

| Screen | State |
|---|---|
| Pickup shop | Where you collect from, remembered |
| Menu | Everything the shop sells, grouped, with honest stock |
| Product | Sizes, prices, allergens, how far ahead to order |

**Checkout is absent rather than half-built.** It needs a Square sandbox
application id — `.env.local` currently holds the placeholder `demo-not-use` —
and a release build on a physical device to prove the card sheet works on the
New Architecture. The Phase 3 plan puts checkout last for that reason. Screens
that cannot honestly finish a purchase say so instead of offering a button that
does nothing.

## The rule this app is built around

**Unknown is not available.**

Stock is only known once a pickup shop is chosen, and offline the app has
nothing to go on. So availability has three states, not two, all the way from
the API (`available: boolean | null`) to the words on screen. A menu that
quietly presents unknown as available is how somebody pays for a cake the shop
cannot make, drives across town, and is told no at the counter.

The same reasoning applies to allergens. An empty list means the shop has not
said — never "free from" — and the product screen prints that in words rather
than showing nothing.

## Not a port of the web homepage

That page is 634 lines written to convince a stranger the bakery is worth
trying. Somebody who has installed the app is past that argument. The app opens
on the food.

## Running it

```bash
npm install
npx expo prebuild --clean
npx expo run:ios          # or run:android
```

Defaults to `http://localhost:3000`, which the iOS Simulator resolves to your
machine. A real handset needs an address on the same network:

```bash
# .env
EXPO_PUBLIC_API_URL=http://192.168.1.42:3000
```

## Choosing a shop

The first thing the app asks, because until it is answered nothing can be said
about stock — and "we don't know" against every price is a poor first impression
for a bakery that does in fact have the cake.

Skippable, and it says so. Somebody deciding whether this place is worth a trip
should not have to commit to a branch first; the menu handles not knowing. The
choice is remembered, so it is asked once rather than every launch.

Opening hours are shown for *today in the device's timezone* — deliberately not
a pickup-date calculation. Those are store-local and stay strings. This one is
"what day is it where you are standing", which is the right question for someone
deciding whether to walk over.

## What's next, in order

1. **Order lookup and the offline pickup pass.** The pass is a static signed
   string, so it can be stored at order time and shown with no signal — which is
   exactly when you need it, standing in a shop.
3. **Sign in** — magic link, SMS code, passkey. This is where universal links
   matter, and where expo-router would have earned its keep; see the staff app's
   README for why it is not installed.
3. **Checkout**, once there is a Square sandbox id and a device to prove the
   card sheet on.

## Shared code

None yet. `src/theme.ts` and `src/format.ts` are copied from the staff app,
which makes three sources of truth for one palette — the argument for the shared
tokens package, which needs the workspace move.
