# Release Gate A — first real (sandbox) payment, end to end

The one risk this gate retires: **the money path has never processed a real
payment**. Everything pure around it is tested; the Square calls are not. This
runbook records the staging topology, the scenario checklist, the evidence
collected so far, and exactly what each remaining scenario needs.

## Topology (discovered 2026-08-23, verify before re-running)

- **The Vercel "Production" environment is the sandbox staging.** The deployed
  site at <https://harina-bakeshoppe.vercel.app> serves `noindex`, its CSP points
  at `sandbox.web.squarecdn.com`, and `NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox`.
  No custom domain is attached; no real customer has ever been served. The
  original plan's "separate preview env" is unnecessary — and unusable, because
  every env var is Production-scoped and `scripts/vercel-build.ts` refuses
  migrations anywhere else.
- **Database:** the Neon `neondb` referenced by the local `.env.local`
  `DATABASE_URL` is the same database the deployment uses (verified: contains
  the deployment-era orders, including the real sandbox draft below). Migrations
  0000–0009 applied.
- **Square sandbox:** one live location — "Default Test Account",
  80 Wellington St, Ottawa (`L3183DNNM7EFF`). The access token lives only in
  Vercel as a Sensitive variable and cannot be pulled locally.
- **Webhooks:** `SQUARE_WEBHOOK_NOTIFICATION_URL` is Vercel-Sensitive; the
  subscription presumably targets the stable production alias. Webhook liveness
  is proven the first time scenario ① runs (a `payment.updated` row must appear
  in `webhook_events` — currently 0 rows ever).
- Deploy with `vercel deploy --prod --yes` from the repo (CLI user must be on
  the team). The build runs `build:vercel`, which migrates this database under
  an advisory lock.

## Scenario checklist

| # | Scenario | Status | Evidence / blocker |
|---|---|---|---|
| ⑨ | Concurrency suites vs the staging DB (overbooking race ×2 windows, inventory final-unit race, hold expiry) | **PASS 2026-08-23** | `TEST_DATABASE_URL=<neon> npx vitest run …integration…` — 8/8 through the Neon pooler, deploy `1093372`+worktree. Required the `test-race-` slug fix (below). |
| — | Deployed health + config | **PASS 2026-08-23** | `GET /api/health` → `{ok:true, db:"up", environment:"sandbox"}` on the production alias. |
| ① | Successful checkout with sandbox test card `4111 1111 1111 1111` | **BLOCKED: no stock** | Every variation shows "Sold out here" — the sandbox location has zero `IN_STOCK` counts and the app deliberately treats a missing count as 0 (`lib/inventory/raw.ts`). Fix in Square Dashboard (enable tracking + set stock at Default Test Account) or via Inventory API with the sandbox token. |
| ② | Declined payment (card `4000 0000 0000 0002`), no charge, order recoverable | Blocked by ① | Same prerequisite. |
| ③ | Duplicate pay submission → exactly one Square payment id | Blocked by ① | Lease machinery is unit-tested (`lib/orders/payment-lease.test.ts`); browser double-click confirms end to end. |
| ④ | Expired hold → payment refused, capacity freed | Blocked by ① | Force-expire via SQL (`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE order_id = …`) rather than waiting 10 min. |
| ⑤ | Price-change mid-checkout → total-mismatch abort, no charge | Blocked by ① + needs catalog write access | Change a variation price in the sandbox Dashboard between reserve and pay. |
| ⑥ | Webhook duplicate delivery is a no-op | Needs Square Developer Console | Use the console's "resend" on a delivered event; expect `{duplicate:true}` and no state change. First delivery itself is verified by ①. |
| ⑦ | Staff transitions mirror to Square; completion only via pickup verification; POS-side COMPLETED sets the needs-verification warning | **BLOCKED: staff password** | The deployed `STAFF_DASHBOARD_PASSWORD` is Vercel-Sensitive and is not the demo one (verified: one failed attempt). |
| ⑧ | Customer self-cancel → Square refund → `refund.updated` reconciles `refund_status` | Blocked by ① | Place the order with a far-out pickup date so cancellation stays eligible. |

**To finish the gate, the operator must supply:** ⓐ sandbox inventory counts
(Dashboard) *or* the sandbox access token, ⓑ the deployed staff password,
ⓒ (optional, for ⑥) a Developer Console webhook resend. Everything else is
scripted or scriptable from this repo.

## Sandbox test values

- Success: `4111 1111 1111 1111`, any future expiry, any CVV, any postal code.
- Generic decline: `4000 0000 0000 0002`. CVV decline: any card with CVV `911`.
  Postal-code decline: postal `99999`.

## Evidence queries (run against the staging DB)

```sql
-- one order, one Square order id, one payment id, hold converted
select order_number, status, square_order_id, square_payment_id, paid_at
  from orders order by created_at desc limit 3;
-- webhook liveness + idempotency
select square_event_id, type, processed_at, error from webhook_events
  order by received_at desc limit 10;
-- notification outcomes per channel
select event, channel, status, attempts, last_error from notification_log
  order by created_at desc limit 10;
-- no capacity leaks after failures/expiry
select count(*) from slot_holds where expires_at > now();
select count(*) from inventory_holds where expires_at > now();
```

## Findings so far

1. **Slug collision made the overbooking suite vacuous on shared databases.**
   The test seeded its product with slug `ensaymada-tray`, which the real
   catalog row already owns on staging; `onConflictDoNothing` silently skipped
   the insert and every claim was rejected on missing rules (0 winners instead
   of 1). Fixed with a `test-race-` slug. The suite also leaves one inert
   `DEMO_ITEM_ENSAYMADA` config row behind — invisible to the storefront (no
   matching Square item), needed for reruns.
2. **A real sandbox draft order exists from 2026-08-19** (`PT-G6MFQV`,
   `pending_payment`, real Square order id, no payment) — proof the deployed
   app reaches real Square, and a live example of the "stuck checkout" that
   staff currently cannot see (Tier-2 queue work addresses this).
3. **Missing inventory counts ⇒ the whole menu is sold out.** By design, a
   variation with no Square `IN_STOCK` count at the selected location is
   unsellable. Operational prerequisite for launch: every sellable variation
   needs inventory tracking enabled with a count at every pickup location —
   worth stating plainly in the client handoff.
