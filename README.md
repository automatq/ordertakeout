# Bakery Party Tray Pre-Ordering

Online pre-ordering and pickup scheduling for a bakery's party trays, integrated with the
store's existing **Square** POS.

Customers choose one of three Square-managed pickup locations, see that branch's inventory,
order Ensaymada, Hopia and Ube Bar trays, choose a pickup date and time, and pay online.
Paid orders land in the selected Square location *and* in a purpose-built staff dashboard,
with email, SMS and chat notifications.

## Documentation

| Document | What's in it |
|---|---|
| [`docs/SCOPE.md`](docs/SCOPE.md) | Full scope, architecture, data model, build phases |
| [`docs/CLIENT-ANSWERS.md`](docs/CLIENT-ANSWERS.md) | Plain-language answers for the store, and what we need from them |
| [`docs/THEMING.md`](docs/THEMING.md) | How the app is built without a defined visual theme, and the branding-handoff checklist |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Postgres via Drizzle ·
Square Node SDK 45 · deployed on Vercel.

## Run the demo

A working demo with no Square account and no cloud services. Needs a Postgres you can
connect to — local, Neon, Supabase, anything.

```bash
createdb ordertakeout_demo          # or use a Neon/Supabase connection string
cp .env.demo .env.local             # edit DATABASE_URL if not local
npm install
npm run demo                        # migrate + seed + start
```

Then open <http://localhost:3000>. Staff dashboard is at `/staff` — password `demo1234`.
If port 3000 is taken, `PORT=3100 npm run demo`.

The seed creates three demo pickup locations, the three product lines with the rules from
the requirements document, branch-specific inventory, five sample orders across today and
tomorrow, a location closure, and one pickup slot capped at two orders — so the
location-aware sold-out, "fully booked", and "closed" states are visible.

**What's real and what isn't.** Only two things are faked: the catalog is served from a
fixture instead of Square, and payment is simulated (with a checkbox to simulate a decline,
so the failure path can be demoed too). Everything else runs for real against the database
— the cutoff rules, slot reservation and capacity, the kitchen screen, status transitions,
notification logging.

Demo mode is `DEMO_MODE=1` and **cannot be enabled when `NODE_ENV=production`**. A build
that fakes payments must never reach customers.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill it in — see notes below
npm run db:push              # apply the schema to your database
npm run dev
```

### Environment

`.env.example` documents every variable. Four are worth calling out:

- **`STORE_TIMEZONE`** has no default and is the fallback for legacy records. Active Square
  locations supply their own timezone, so every cutoff and pickup calculation runs in the
  selected branch's local time.
- **Square credentials** should be Sandbox for all development. Production credentials go
  in only at launch.
- **`SQUARE_WEBHOOK_NOTIFICATION_URL`** must match the subscription URL in the Square
  console character for character — it's part of the signed payload, so even a trailing
  slash mismatch will fail verification.
- **`CRON_SECRET`** protects the maintenance endpoint that expires holds, retries provider
  failures, and applies the configured customer-data retention policy. `vercel.json` runs it
  once daily at 08:17 UTC, which is compatible with Vercel Hobby cron limits.

Notification channels are all optional; an unset channel is skipped by the dispatcher, so
the store can enable one later without a code change.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm test` | Vitest |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema directly (development only) |
| `npm run db:backfill-legacy-location` | One-time location backfill after a multi-location upgrade |
| `npm run db:studio` | Drizzle Studio |

## Project layout

```
app/                Next.js routes; globals.css holds the entire design-token layer
lib/scheduling/     Pickup availability engine — cutoffs, lead times, capacity, slot holds
lib/db/             Drizzle schema and connection
lib/square/         Square SDK client and money-conversion helpers
lib/env.ts          Zod-validated environment configuration
lib/store.ts        Store constants and product ordering rules from the requirements doc
drizzle/            Generated SQL migrations
docs/               Scope, client-facing answers, theming guide
```

## Testing

```bash
npm test
```

**The suite runs in `Pacific/Chatham` on purpose** (set in `vitest.config.ts`). Pickup
dates are store-local and the store's zone is always passed in explicitly, so no
calculation should depend on the machine's clock. Running tests in a developer's own US
timezone hides exactly the bugs that matter here — a US machine makes naive local-date
arithmetic look correct. Chatham is UTC+12:45, has a 45-minute offset, and observes DST.

The scheduling tests were checked by mutation: breaking the cutoff comparison, the
mixed-cart lead time, and the calendar-day arithmetic each make the suite fail. That last
one is why the hostile timezone is there — under a US zone the broken version passed all
54 tests.

### Before launch

Everything below needs a real Postgres and Square Sandbox credentials. Until then the app
has never processed an order end to end, and that should be assumed rather than hoped
against.

1. Point `DATABASE_URL` at the production database and run `npm run db:migrate`.
2. For an existing installation, set `LEGACY_SQUARE_LOCATION_ID` to the active Square shop
   that owned all pre-multi-location orders, keep `DATABASE_URL`, `SQUARE_ACCESS_TOKEN`, and
   `NEXT_PUBLIC_SQUARE_ENVIRONMENT` pointed at the same production environment, then run
   `npm run db:backfill-legacy-location`. The command validates the location before writing,
   runs atomically, reports unresolved legacy line items, and is safe to rerun.
3. Add Square credentials and subscribe to the four webhook events listed below.
4. Open `/staff/settings` and configure the three products — the store's rules for Hopia
   and Ube Bars are still unconfirmed, so this is also where those get set.
5. Place a sandbox order end to end and walk it through every status.
6. Run the concurrency tests described below before taking real money.

### The overbooking race — verified

`lib/scheduling/concurrency.integration.test.ts` fires ten simultaneous checkouts at a slot
with capacity 1 and asserts exactly one wins, plus twelve at a slot with capacity 3. It
needs a real Postgres, so it skips unless you point it at one:

```bash
TEST_DATABASE_URL=postgresql://localhost:5432/ordertakeout_demo npm test
```

Confirmed meaningful by mutation: removing the advisory lock makes **two** customers win
the last slot locally, and lets all twelve into a three-order slot.

**Verified through Neon's connection pooler**, which is the topology that matters — a
transaction pooler is exactly where transaction-scoped advisory locks could silently stop
working. They don't. Notably the same mutation lets **six** customers win the last slot on
Neon versus two locally: the extra network latency widens the race window, so this bug
would be worse in production than it looks on a developer's machine.

### Not yet covered

- **The whole checkout path.** Order creation, payment and the confirmation page are
  written but have never processed a real payment — they need Square Sandbox credentials.
  Everything pure around them (cart resolution, pricing, order numbers, scheduling) is
  tested; the Square calls themselves are not.
- **Webhook side effects.** The signature gate, event parsing and status-transition rules
  are tested — the signature check end to end over HTTP, including rejection of tampered
  bodies and trailing-slash URL mismatches. What is *not* tested is what happens after:
  reconciling an order to paid, and syncing a fulfillment state. Those need a database.
- **The dashboard with real orders.** Session tokens are unit-tested (expiry, forged
  expiry, wrong password, malformed input) and the route guard is verified end to end over
  HTTP — unauthenticated and forged-cookie requests to every staff route redirect to login.
  What hasn't run is the screen with actual orders in it: the queue, the chime, and status
  changes mirroring to Square all need a database and Sandbox credentials.
- **Real notification delivery.** Message rendering and every channel adapter are tested
  against a stubbed `fetch` — correct URL, method, auth header and body for all six. No
  message has actually been delivered to a real provider; that needs API keys. The
  dispatcher's de-duplication and logging need a database.

### Checkout invariants

Worth knowing before changing anything in `lib/orders/create.ts`:

- **Prices never come from the browser.** The cart stores variant ids and quantities only;
  everything is re-priced server-side from the Square catalog.
- **Square prices the order, not us.** Line items carry catalog ids and no amounts. Square's
  computed total is compared against what the customer was shown, and a mismatch aborts
  checkout rather than charging a different number — even a lower one.
- **The payment idempotency key is the order id.** Stable per order, so a double-clicked pay
  button or a network retry cannot double-charge. Never regenerate it on retry.
- **The slot is reserved before the card form appears**, and the reservation expires on its
  own — an abandoned checkout frees the slot with no compensating action.

## Conventions

- **Money is integer cents everywhere.** No floats. The Square SDK uses `bigint`; convert
  at the boundary with the helpers in `lib/square/client.ts`.
- **Pickup dates and times are wall-clock at the store** (`date` / `time`, no timezone) —
  "4 PM pickup" means 4 PM in the shop regardless of DST. Instants (`created_at`, `paid_at`)
  are `timestamptz`.
- **Square owns products and prices**; this database owns what Square can't express
  (lead times, cutoffs, capacity, blackout dates). A product with no `products_config`
  row is deliberately not sellable — without a cutoff we'd be promising a pickup the
  kitchen never agreed to.
- **Cart lines reference variants; scheduling works in product lines.** "25 pcs Ube" has
  the price, but the daily production cap belongs to Ensaymada as a whole — one oven, one
  budget. `lib/catalog/cart.ts` does the aggregation.
- **Caching uses Next 16 Cache Components** (`cacheComponents: true`): `use cache` with
  `cacheLife`/`cacheTag`, invalidated via `updateTag`. `unstable_cache` and route-level
  `export const revalidate` are the previous model and are not used here.
- **No hardcoded colours in components** — see [`docs/THEMING.md`](docs/THEMING.md).

## Status

- **Phase 1 — Foundation:** done. Scaffold, database schema + migration, environment
  validation, Square client, design-token layer.
- **Phase 2 — Catalog:** done. Square Catalog sync joined to ordering rules, storefront
  listing and product pages.
- **Phase 3 — Scheduling engine:** done. Lead times, the 6:00 PM cutoff, pickup-window
  intersection for mixed carts, blackout dates, per-slot and per-day capacity, and the
  transactional slot hold.
- **Phase 4 — Cart & checkout:** code complete, **unverified end to end**. Cart, pickup
  picker, Square Web Payments card entry, order creation, payment, confirmation page.
  Needs Square Sandbox credentials to actually run a payment through.
- **Phase 7 — Webhooks:** done. Signed endpoint at `/api/webhooks/square` handling
  `payment.updated` (payment reconciliation), `refund.created` and `refund.updated`
  (refund reconciliation), and `order.fulfillment.updated` (two-way status sync with
  Square POS), with replay-safe idempotency.
- **Phase 5 — Staff dashboard:** done. Password-gated order screen at `/staff` with live
  polling and a new-order chime, one-tap status changes that mirror to Square, a completed
  orders view, and a printable per-day prep sheet.
- **Phase 6 — Notifications:** done. One dispatcher fanning out to email, SMS, Discord,
  Slack, Trello and a generic webhook, with per-channel delivery logging.
- **Phase 8 — Admin:** done. `/staff/settings` for per-product ordering rules, closure
  dates, per-slot caps and an immediate catalog re-sync.

**All build phases are code complete.** What remains before launch is verification against
a real database and Square Sandbox — see *Not yet covered* below.

182 tests pass, with 5 database integration tests intentionally skipped unless
`TEST_DATABASE_URL` is set. See the full build phases in [`docs/SCOPE.md`](docs/SCOPE.md).

## Admin

`/staff/settings`. Staff can set each product's lead time, cutoff, pickup times and daily
tray cap; add closure dates; cap or close individual pickup slots; and pull item names and
prices from Square on demand.

- **Products Square knows about but we have no rules for are listed first**, flagged as not
  yet orderable. They can't be sold without a cutoff — that would mean promising a pickup
  the kitchen never agreed to — so they're surfaced rather than silently missing.
- **Every write invalidates the cached catalog.** Otherwise staff would change a cutoff,
  see no difference, and reasonably conclude the form is broken.
- **Questionable-but-legal configurations warn rather than block** — a zero-day lead time,
  or a cutoff that makes early slots unreachable. It's the store's call, but they should
  know they made it.
- **Notification channels stay in environment variables**, not this UI. They're API
  credentials, and a database-backed settings screen would mean storing secrets in
  plaintext next to the order data.

## Notifications

One event in, every configured channel out. Channels run concurrently and independently —
Twilio being down must not stop Discord or email. Store and customer emails are separate
retry units, so a partial Resend failure cannot duplicate the recipient that succeeded.
Every attempt is written to `notification_log`, so *"the store says they never got the
text"* is an answerable question rather than a guess.

Fired from three places: checkout (`order_paid`), staff status changes (`order_ready`,
`order_canceled`), and webhook reconciliation. Delivery runs inside Next's `after()`, so
nobody waits on Resend or Twilio to see their confirmation page, and a notification failure
can never fail a payment that has already gone through.

- **Each adapter is a plain `fetch`**, not a vendor SDK. Six SDKs would be six dependency
  trees for what amounts to six POST requests, and going direct means the HTTP request *is*
  the whole contract — so the tests assert on exactly that.
- **Dispatch atomically de-duplicates per order, event and recipient channel.** Checkout and the
  `payment.updated` webhook can both fire `order_paid` for the same order; without this the
  store gets everything twice.
- **An unconfigured channel is skipped, not failed**, and is not written to the log — so
  enabling it later doesn't look like it had already delivered.
- **The store's SMS is capped to one 160-character segment**, dropping items with a
  "+N more" suffix. A message that silently spills into three segments triples the bill on
  every order.

## Staff dashboard

`/staff`, behind a single shared password (`STAFF_DASHBOARD_PASSWORD`) — no per-user
accounts in v1, as agreed. The session is a signed, expiring cookie with no session table,
so **changing the password signs everyone out**, which is the behaviour you want after
someone leaves.

Two things worth knowing:

- **The guard is in the layout, not in Proxy.** Next 16 renamed Middleware to Proxy, and
  its docs are explicit that it is not a session-management solution. The staff layout is
  also `export const instant = false` — an authorization gate must block rather than stream
  a staff-looking shell before knowing who is asking.
- **Server actions re-check the session themselves.** A layout guard stops a page
  rendering, but server actions are independently addressable endpoints; anyone who knows
  an action id can call it directly. `requireStaffSession()` runs in both places.

Status changes write to our database first, then mirror to Square. If Square is
unreachable the local change stands and a warning appears — the kitchen screen must keep
working during a Square outage, and the `order.fulfillment.updated` webhook reconciles the
two afterwards.

## Webhooks

Subscribe to **`payment.updated`**, **`refund.created`**, **`refund.updated`**, and
**`order.fulfillment.updated`** in the Square Developer Console, pointed at
`/api/webhooks/square`. They do three jobs:

- **Reconciliation.** If the database write immediately after a successful payment ever
  fails, the customer has been charged while our order still says `pending_payment`.
  `payment.updated` repairs that without anyone noticing.
- **Two-way status sync.** Staff can advance an order in Square Point of Sale instead of
  our dashboard; `order.fulfillment.updated` brings those changes back so both agree.
- **Refund reconciliation.** `refund.created` and `refund.updated` keep pending, completed,
  failed, and rejected refunds aligned with the local cancellation state.

Three things to know before touching this code:

- **The raw body must be read with `request.text()`, never `request.json()`.** The
  signature is an HMAC over the exact bytes Square sent; re-serialising parsed JSON changes
  them and every signature fails.
- **Webhook payloads are snake_case.** The Square SDK's TypeScript types are camelCase
  because the SDK deserialises API *responses* — a webhook body is not one. Parsing against
  the SDK shape compiles fine and then matches nothing at runtime. `lib/webhooks/events.ts`
  has snake_case Zod schemas, and a test that fails if someone "corrects" them.
- **Idempotency is keyed on "already processed", not "already seen".** An attempt that
  recorded the event then failed mid-processing must be retried; stamping `processed_at` on
  failure would make Square's retry a silent no-op.

`SQUARE_WEBHOOK_NOTIFICATION_URL` must match the console subscription character for
character — the URL is part of the signed payload, so a trailing-slash difference fails
verification. There's a test for exactly that.

### Known tradeoff

`/products/[slug]` uses partial prerendering, so the shell streams before the product
lookup resolves. An unknown slug therefore returns **HTTP 200 with 404 content** (a
soft-404). Fine for customers, not ideal for search engines. If that matters, either add
`generateStaticParams` for the real slugs or set `export const instant = false` on the
route to make it blocking and return a true 404 — at the cost of the instant shell.
