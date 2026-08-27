# Harina Bakeshoppe

The customer app. Order ahead, collect in store.

## What's here, and what deliberately is not

| Screen | State |
|---|---|
| Pickup shop | Where you collect from, remembered |
| Menu | Everything the shop sells, grouped, with honest stock |
| Product | Sizes, prices, allergens, how far ahead to order |
| Order | Your order and the code that collects it, with or without signal |
| Sign in | A texted code — no password |
| Your orders | Everything you've ordered, newest first |

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

## The pickup pass, and why it is in an app at all

The pass is a static signature over the order. It does not expire and needs no
network to be valid, so the app stores it the moment the order is opened and can
show it in a shop with thick walls and no bars — which is exactly where a website
fails somebody.

That only works if the *route to it* is offline too, and at first it was not: the
app opened on the menu, the menu could not load, and the error state offered
nothing but "Try again". Somebody standing at a counter with no signal, whose one
reason for opening the app was the code, hit a dead end. Found by killing the
server and launching it. The saved-order card now renders above the failure as
well as above the menu.

The order screen shows the stored copy first and refreshes behind it, in that
order deliberately: the one moment it has to work is the moment a network call
would be spinning. When the refresh fails it says so — a stale total is fine, a
stale "ready to collect" is the sort of thing people plan a trip around.

## Getting into the app

Deep links, for now: `harina://orders/PT-ABC123?key=…`. The confirmation email
and SMS already carry the order number and the signed key that opens it, and
`parseDeepLink` accepts the website and short-link shapes too, so the same URLs
work unchanged once universal links are configured.

That parsing is the one piece of this app with unit tests. Deep links are
otherwise only ever exercised by hand, badly, and getting one wrong sends
somebody who tapped a link in their confirmation email to the wrong screen —
which nobody notices until a customer says so.

## Signing in

A texted code rather than a magic link. A link has to leave the app, open a mail
client and come back, and on a phone that round trip loses people. A code stays
in one place, and both platforms offer it as a one-tap suggestion above the
keyboard the moment the text arrives — `autoComplete="sms-otp"` and
`textContentType="oneTimeCode"` are what make that work.

The screen never says whether a number has an account. That is the server's
position and the app must not invent a way around it, so it advances to the code
step either way; stopping early for an unknown number would answer the question
the server refuses to.

Passkeys and the magic link both already exist on the website. Neither is here
yet, and passkeys in particular want universal links to be worth having.

## What's next

**Checkout**, once there is a Square sandbox id and a device to prove the card
sheet on. Everything else in the read path is done.

## Colours

`src/tokens.generated.ts` is written by `scripts/generate-app-theme.mjs` from
the web's `app/globals.css`, which stays the single source of truth. Run
`npm run tokens` from the repo root after changing `@theme`; CI regenerates and
fails on a diff, so a palette change that forgets the apps cannot merge.

They were hand-copied at first and drifted within a day: the brand red was
`#9E3136` in the apps and `#ce3f23` on the web, alongside a green and an amber
that appear nowhere in the palette. Nothing looked broken, which is exactly how
that fails.

## Shared code

None yet. `src/theme.ts` and `src/format.ts` are copied from the staff app,
which makes three sources of truth for one palette — the argument for the shared
tokens package, which needs the workspace move.
