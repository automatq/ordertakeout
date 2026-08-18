# Scope & Implementation Plan — Bakery Pre-Order Pickup Website

> Status: **scope definition** — approved, not yet implemented.
> Source requirements: `.context/attachments/SGX3JE/1one.pdf`

## Context

A Filipino bakery (store hours 5:45 AM – 9:00 PM daily) currently takes party-tray orders manually and runs
**Square** as its POS. They want a website where customers can pre-order party trays, pick a pickup date/time,
and pay online — with orders landing reliably in front of staff.

The requirements PDF lists 8 party-tray SKUs and **9 questions** about how the online ordering system would work.
Those questions *are* the real acceptance criteria — the store's core worry is "will we actually know an order
came in, and will we know it's paid?" This document answers all nine and defines what gets built.

---

## Products (from the PDF)

| Product | Variant | Price |
|---|---|---|
| Ensaymada Party Tray | 25 pcs Ube | $25 |
| Ensaymada Party Tray | 25 pcs Cheese | $20 |
| Ensaymada Party Tray | 56 pcs Ube | $50 |
| Ensaymada Party Tray | 56 pcs Cheese | $40 |
| Hopia Ube / Hopia Baboy | 60 pcs | $45 |
| Hopia Ube / Hopia Baboy | 90 pcs | $65 |
| Ube Bars | Big – 78 pcs | $50 |
| Ube Bars | Small – 48 pcs | $30 |

**Ensaymada ordering rule:** order one day in advance, before 6:00 PM. Pickup starts 4:00 PM the following day.
Pickup times: 4, 5, 6, 7, or 8 PM.
**Hopia and Ube Bars:** require a pickup date + time; exact lead-time rules still TBD (see Open Items).

---

## Answers to the Store's 9 Questions

| # | Question | Answer |
|---|---|---|
| 1 | How will the store be notified of an order? | Four ways at once: **Square POS** (order appears in Order Manager), **email**, **SMS**, and our **staff dashboard** with an audible chime. Plus Discord/Slack/Trello. |
| 2 | Will a new order pop up / notify automatically? | Yes. The staff dashboard updates live and plays a chime; Square POS shows its own new-order alert and can auto-print a receipt. |
| 3 | How can staff see if an order was paid online? | Every order on the site is **paid before it's confirmed**. Square only shows the order once payment clears, so *anything in Square POS is already paid.* The dashboard also shows an explicit PAID badge + Square payment ID. |
| 4 | Will there be separate statuses? | Yes: **New Order → Paid → Preparing → Ready for Pickup → Completed** (+ Canceled). See status mapping below. |
| 5 | Where do orders appear? | All of them: staff **dashboard**, **email**, **Square POS/Dashboard**, and mobile (dashboard is mobile-responsive; SMS to the store phone). |
| 6 | Email or phone notification on every paid order? | Yes — email + SMS fire on payment success, not on cart abandonment. |
| 7 | Can customers pick pickup date & time before checkout? | Yes — date + time slot are **required** before the pay button enables. |
| 8 | Can it block Ensaymada orders after the 6:00 PM cutoff? | Yes — enforced **server-side** in store-local time. Past cutoff, tomorrow's slots disappear and the earliest offered date rolls to the day after. |
| 9 | Can it cap orders per pickup time? | Yes — per-slot order cap **and** per-day production cap per product, both editable by staff. Sold-out slots grey out. |

**One caveat to communicate:** Square only pushes an order into POS/Order Manager **after it is paid**
([Square docs](https://developer.squareup.com/docs/orders-api/fulfillments)). That's fine here because the site is
prepay-only — but it means a "pay at pickup" option could not appear in Square POS. That's why our own dashboard
exists as the source of truth.

---

## Scope

### In scope (v1)
- Public storefront: browse party trays, product detail, cart, checkout
- Pickup date + time-slot picker with per-product lead-time/cutoff rules enforced server-side
- Online payment via **Square Web Payments SDK** (card, Apple Pay, Google Pay, Cash App Pay)
- Orders pushed into **Square** (Orders API, `PICKUP` fulfillment) so they hit the POS
- Staff dashboard: live order queue, status buttons, capacity/blackout admin
- Notifications: email, SMS, dashboard chime, Discord, Slack, Trello, generic webhook
- Customer order-confirmation email + order-status lookup page
- Customer self-cancel with auto-refund until cutoff
- Catalog synced from **Square Catalog** (store edits items/prices in Square Dashboard)

### Out of scope (v1)
- Delivery / shipping — pickup only
- Customer accounts and login (guest checkout only; order lookup by number + email)
- Loyalty, gift cards, discount codes, tipping
- Daily walk-in bakery menu (**data model is built generic so it can be added later**)
- Native mobile app

---

## Architecture

**Next.js (App Router, TypeScript) on Vercel + Postgres.**

```
Browser ──► Next.js (Vercel)
              ├─ Server Actions / Route Handlers  ──► Square APIs (Catalog, Orders, Payments, Refunds)
              ├─ Postgres (Neon/Vercel Postgres)  ──► pickup rules, capacity, order mirror, notif log
              └─ /api/webhooks/square  ◄────────────  Square webhooks (order.fulfillment.updated, payment.updated)
                        │
                        └─► notification dispatcher ─► Resend · Twilio · Discord · Slack · Trello · custom webhook
```

Key libraries: `square` (Node SDK **v45+** — note v40 was a full rewrite; money amounts are `BigInt`),
`@square/web-sdk` for the browser card form, `date-fns-tz` or `Temporal` for store-local time math,
Drizzle or Prisma for Postgres, Zod for validation, Tailwind + shadcn/ui.

**Why Square Catalog as source of truth:** the store already edits prices in Square Dashboard. The website syncs
items, prices, and images from Catalog via `SearchCatalogItems`, so POS and web never drift. Anything Square
*can't* express (lead times, pickup windows, capacity, product images/copy overrides) lives in our DB **keyed by
Square catalog object ID**.

---

## Data Model (Postgres)

```
products_config      square_catalog_object_id (PK) · slug · lead_time_days · order_cutoff_time
                     · pickup_window_start/end · allowed_pickup_times[] · slot_interval_minutes
                     · max_units_per_day · is_orderable · sort_order · hero_image_url · description_md

pickup_slots         date · time · derived capacity  (materialized per day, or computed on read)
slot_capacity        date · time · max_orders · notes                (staff override)
blackout_dates       date · reason                                    (holidays, closures)

orders               id · order_number · square_order_id · square_payment_id
                     · customer_name/email/phone · pickup_date · pickup_time
                     · status · subtotal/tax/total_cents · created_at · paid_at
order_items          order_id · square_catalog_object_id · name_snapshot · qty · unit_price_cents

slot_holds           id · pickup_date · pickup_time · expires_at · order_id   (TTL reservation)
notification_log     order_id · channel · status · payload · attempts · sent_at
webhook_events       square_event_id (unique) · type · body · processed_at    (idempotency)
```

> `name_snapshot` / `unit_price_cents` are stored on `order_items` so a later price change in Square Catalog
> never rewrites the history of a completed order.

---

## Pickup Scheduling Engine (the core logic)

This is the hardest and highest-risk part — it's where the store's questions 7, 8, and 9 live.

**Everything computes in store-local time**, never the browser's clock. Timezone is a config value
(`STORE_TIMEZONE`) — *needs confirming with the store.*

Per-product rules live in `products_config` (configurable, not hardcoded):

| Product | Lead time | Cutoff | Pickup window |
|---|---|---|---|
| Ensaymada (4 SKUs) | 1 day | 6:00 PM | 4, 5, 6, 7, 8 PM |
| Hopia Ube / Baboy | *TBD* | *TBD* | *TBD* |
| Ube Bars (Big/Small) | *TBD* | *TBD* | *TBD* |

Availability algorithm for a cart:
1. Start from now in store-local time.
2. For **each** product in the cart, compute its earliest valid pickup date (`today + lead_time_days`, pushed
   one more day if now is past that product's cutoff).
3. Take the **latest** of those earliest dates — a mixed cart is gated by its slowest item.
4. Intersect the products' allowed pickup windows. If the intersection is empty, tell the customer to split
   the order rather than silently dropping slots.
5. Remove blackout dates and any slot at/over its order cap or the day's production cap.

**Preventing double-booking of the last slot:** a naive "check then insert" races when two customers check out
simultaneously. Before creating the Square payment we take a **`slot_holds` row with a short TTL** (~10 min)
inside a transaction using `SELECT … FOR UPDATE` on the slot; the hold is converted on payment success and
released on failure or expiry. A background sweep clears stale holds.

**Cutoff enforcement is server-side.** The client UI greys out invalid dates for UX, but the checkout Server
Action re-validates every rule before charging — a customer who leaves the page open past 6:00 PM must not slip
through.

---

## Order Lifecycle & Status Mapping

| Our status | Square order/fulfillment | Visible in Square POS? | Trigger |
|---|---|---|---|
| `pending_payment` | draft order created | No | Checkout started |
| `paid` ("New Order") | paid · fulfillment `RESERVED` | **Yes** | Payment succeeds |
| `preparing` | stays `RESERVED` | Yes (active) | Staff taps "Start preparing" |
| `ready` | `PREPARED` (`ready_at` set) | Yes | Staff taps "Ready" |
| `completed` | `COMPLETED` (`picked_up_at` set) | Yes | Staff taps "Picked up" |
| `canceled` | `CANCELED` + refund | Yes | Customer (pre-cutoff) or staff |

> Square's pickup fulfillment has five states (`RESERVED`, `PREPARED`, `COMPLETED`, `CANCELED`, `FAILED`) — one
> fewer than the store asked for. **Preparing** has no distinct Square equivalent, so we track it in our DB and
> show it on our dashboard; Square just shows the order as active.

Checkout sequence: `CreateOrder` (draft, with `PICKUP` fulfillment — `pickup_at` and `recipient.display_name`
are both **required**, `schedule_type: SCHEDULED`) → tokenize card in browser → `CreatePayment` with the order ID
→ on success, mark paid, convert slot hold, fire notifications. **Idempotency keys on every Square mutation** so a
double-clicked pay button or a retry can't double-charge.

Status changes made by staff *inside Square POS* flow back to us via the `order.fulfillment.updated` webhook, so
the two surfaces stay in sync in both directions.

---

## Notifications

A single **dispatcher** takes one `OrderPaid` / `OrderStatusChanged` event and fans out to every enabled channel,
logging each attempt to `notification_log` with retry. One place to add channels; a failure in one never blocks
another.

**To the store, on every paid order:** email (Resend), SMS (Twilio), dashboard chime, Discord embed, Slack
message, Trello card on a "Pickup Orders" board, and a generic user-configurable webhook URL. Square POS raises
its own new-order alert and can auto-print.

**To the customer:** order confirmation on payment, "Ready for Pickup" on status change, cancellation/refund
confirmation.

---

## Staff Dashboard

Password-protected (simple shared staff login — no per-user accounts in v1).

- **Today / Tomorrow / Upcoming** queues grouped by pickup time slot, newest first
- New paid order → audible chime + visual highlight, live via polling (a few seconds) or SSE
- One-tap status buttons; each writes to Square *and* our DB
- Big PAID badge, payment method, Square payment ID, order total
- Print-friendly ticket per order and a per-slot prep sheet ("4 PM: 3× 25pc Ube, 1× 56pc Cheese")
- **Admin:** per-slot caps, per-day production caps, blackout dates, per-product lead time/cutoff/windows,
  toggle a product off when sold out, re-sync catalog from Square, notification channel settings

---

## Build Phases

1. **Foundation** — Next.js + TS + Tailwind scaffold, Postgres + schema/migrations, env config, Square sandbox
   credentials, deploy to Vercel early so there's always a live URL.
2. **Catalog** — Square Catalog sync (`SearchCatalogItems`) + `products_config` overlay; storefront listing and
   product pages for the 8 SKUs.
3. **Scheduling engine** — the rules above, with **unit tests first** (cutoff boundaries, DST, mixed carts,
   blackouts, capacity). This is the piece most likely to have subtle bugs; test it before wiring UI.
4. **Cart + checkout** — cart state, pickup picker, Web Payments SDK card form, slot hold, `CreateOrder` +
   `CreatePayment`, confirmation page/email. Apple Pay needs **domain verification** in the Square Developer
   Console; Google Pay needs merchant setup.
5. **Staff dashboard** — auth, live queue, status transitions writing to Square, print views.
6. **Notifications** — dispatcher + all channels + retry/logging.
7. **Webhooks** — signed endpoint (`x-square-hmacsha256-signature`, HMAC-SHA-256; use the SDK's
   `WebhooksHelper.verifySignature()`) for `payment.updated` and `order.fulfillment.updated`, with
   `webhook_events` de-dup so replays are safe.
8. **Admin** — capacity, blackouts, per-product rules, channel config.
9. **Polish & launch** — mobile QA, accessibility, SEO/OG, error states, store-hours/holiday copy, sandbox→
   production credential swap, real end-to-end order with the store watching their POS.

---

## Config & Secrets

`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT` (sandbox|production),
`SQUARE_APPLICATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `DATABASE_URL`, `STORE_TIMEZONE`,
`RESEND_API_KEY`, `STORE_NOTIFY_EMAIL`, `TWILIO_*`, `STORE_NOTIFY_PHONE`,
`DISCORD_WEBHOOK_URL`, `SLACK_WEBHOOK_URL`, `TRELLO_KEY`/`TRELLO_TOKEN`/`TRELLO_LIST_ID`,
`CUSTOM_WEBHOOK_URL`, `STAFF_DASHBOARD_PASSWORD`.

Build entirely against **Square Sandbox**; production credentials only at launch.

---

## Verification

- **Unit tests** on the scheduling engine — cutoff at 5:59 vs 6:01 PM, DST transitions, mixed-lead-time carts,
  blackout dates, capacity exhaustion, expired slot holds.
- **Integration tests** against Square Sandbox — create order → pay with a test card → assert the Square order is
  paid with a `RESERVED` pickup fulfillment and correct `pickup_at`.
- **Concurrency test** — fire N simultaneous checkouts at a slot with capacity 1; assert exactly one succeeds.
- **Webhook test** — replay a signed `order.fulfillment.updated` payload; assert status syncs and that a
  duplicate `event_id` is ignored.
- **Manual end-to-end** — place a sandbox order on a phone; confirm chime on dashboard, email arrives, SMS
  arrives, Discord/Slack/Trello populate, order visible in Square Sandbox Dashboard marked paid; then walk it
  through Preparing → Ready → Completed and confirm both surfaces agree.
- **Pre-launch with the store** — one real small-dollar order on production credentials, watching their actual
  POS, then refund it.

---

## Assumptions (change any of these freely)

- **Capacity:** both a per-slot order cap and a per-day production cap per product, staff-editable.
- **Cancellation:** customer can self-cancel with automatic Square refund until that product's cutoff; after
  cutoff it's staff-only from the dashboard.
- **Timezone:** a config value with no default — must be set before launch.
- **Guest checkout only** — no customer accounts in v1.

See [`CLIENT-ANSWERS.md`](./CLIENT-ANSWERS.md) for the plain-language version to send the store, including the
list of information we still need from them.
