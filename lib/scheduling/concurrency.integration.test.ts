import { sql } from "drizzle-orm";

import { addCalendarDays, storeToday } from "./time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The overbooking race, against a real Postgres.
 *
 * This is the one property that cannot be unit-tested: `reserveSlotWithin` takes
 * a transaction-scoped advisory lock so two customers can't buy the last 4 PM
 * slot, and proving that needs two genuinely concurrent connections. An embedded
 * or mocked database would happily pass a broken implementation.
 *
 * Skipped unless TEST_DATABASE_URL is set, so the normal suite stays hermetic:
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/ordertakeout_demo npm test
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

/**
 * A date the engine would actually offer: past every lead time and within
 * MAX_ORDER_HORIZON_DAYS. A date beyond the horizon is rejected before capacity
 * is ever consulted, which would make this test pass vacuously. With the short
 * booking window this sits at the horizon edge — the latest date still bookable
 * regardless of whether the order is placed before or after the daily cutoff.
 */
const SLOT_DATE = addCalendarDays(
  storeToday(new Date(), process.env.STORE_TIMEZONE ?? "America/Los_Angeles"),
  3,
);
const SLOT_TIME = "16:00";
const PRODUCT_ID = "DEMO_ITEM_ENSAYMADA";
const LOCATION_A = "TEST_LOCATION_TORONTO";
const LOCATION_B = "TEST_LOCATION_LONDON";

describeIfDb("slot reservation under concurrency", () => {
  let db: typeof import("@/lib/db").db;
  let claimSlot: typeof import("./queries").claimSlot;
  let schema: typeof import("@/lib/db/schema");
  let client: import("postgres").Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.STORE_TIMEZONE ??= "America/Los_Angeles";
    process.env.SQUARE_ACCESS_TOKEN ??= "test";
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ??= "test";
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??= "https://example.com/hook";
    process.env.STAFF_DASHBOARD_PASSWORD ??= "test-password";

    ({ db } = await import("@/lib/db"));
    ({ claimSlot } = await import("./queries"));
    schema = await import("@/lib/db/schema");

    const postgres = (await import("postgres")).default;
    client = postgres(TEST_DATABASE_URL!, { prepare: false });

    await cleanup();

    // The product must be orderable with this pickup time, or every claim is
    // rejected on the rules rather than on capacity — which would make the test
    // pass for entirely the wrong reason.
    await db()
      .insert(schema.productsConfig)
      .values({
        squareCatalogObjectId: PRODUCT_ID,
        slug: "ensaymada-tray",
        leadTimeDays: 1,
        orderCutoffTime: "18:00",
        allowedPickupTimes: ["16:00", "17:00", "18:00", "19:00", "20:00"],
        maxUnitsPerDay: null,
        isOrderable: true,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await cleanup();
    await client.end();
  });

  async function cleanup() {
    await client`DELETE FROM slot_holds WHERE pickup_date = ${SLOT_DATE}`;
    await client`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE pickup_date = ${SLOT_DATE})`;
    await client`DELETE FROM orders WHERE pickup_date = ${SLOT_DATE}`;
    await client`DELETE FROM slot_capacity WHERE pickup_date = ${SLOT_DATE}`;
  }

  /** Create N unpaid orders that will all race for the same slot. */
  async function createContenders(count: number, locationId = LOCATION_A): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const [order] = await db()
        .insert(schema.orders)
        .values({
          orderNumber: `PT-R${locationId === LOCATION_B ? "B" : "A"}CE${String(i).padStart(2, "0")}`,
          customerName: `Racer ${i}`,
          customerEmail: `racer${i}@example.com`,
          customerPhone: "+15550000000",
          squareLocationId: locationId,
          pickupDate: SLOT_DATE,
          pickupTime: SLOT_TIME,
          status: "pending_payment",
          subtotalCents: 2500,
          totalCents: 2500,
        })
        .returning({ id: schema.orders.id });
      ids.push(order!.id);
    }
    return ids;
  }

  it("lets exactly one of ten simultaneous checkouts take the last slot", async () => {
    await db()
      .insert(schema.slotCapacity)
      .values({ squareLocationId: LOCATION_A, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 1 })
      .onConflictDoUpdate({
        target: [schema.slotCapacity.squareLocationId, schema.slotCapacity.pickupDate, schema.slotCapacity.pickupTime],
        set: { maxOrders: 1 },
      });

    const orderIds = await createContenders(10);
    const cart = [{ productId: PRODUCT_ID, quantity: 1 }];

    // Fired together on purpose: this is the check-then-act race that a naive
    // "read the count, then insert" implementation loses.
    const results = await Promise.all(
      orderIds.map((orderId) => claimSlot(orderId, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A)),
    );

    const won = results.filter((r) => r.ok);
    const lost = results.filter((r) => !r.ok);

    // Surfaces *why* if nothing wins — otherwise "expected 1, got 0" says
    // nothing about whether the lock worked or the slot was never offered.
    expect(
      { won: won.length, sampleRejection: lost[0]?.ok === false ? lost[0].rejection : null },
    ).toMatchObject({ won: 1 });
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(9);

    // And the losers must be told why, not fail opaquely.
    for (const result of lost) {
      if (result.ok) continue;
      expect(result.rejection.kind).toBe("slot_unavailable");
    }

    // The database must agree — exactly one live hold on that slot.
    const holds = await client`
      SELECT count(*)::int AS n FROM slot_holds
      WHERE pickup_date = ${SLOT_DATE} AND pickup_time = ${SLOT_TIME} AND expires_at > now()
    `;
    expect(holds[0]?.n).toBe(1);
  }, 30_000);

  it("fills a slot with capacity 3 exactly three times, no more", async () => {
    await cleanup();
    await db()
      .insert(schema.slotCapacity)
      .values({ squareLocationId: LOCATION_A, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 3 });

    const orderIds = await createContenders(12);
    const cart = [{ productId: PRODUCT_ID, quantity: 1 }];

    const results = await Promise.all(
      orderIds.map((orderId) => claimSlot(orderId, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A)),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(3);

    const holds = await client`
      SELECT count(*)::int AS n FROM slot_holds
      WHERE pickup_date = ${SLOT_DATE} AND pickup_time = ${SLOT_TIME} AND expires_at > now()
    `;
    expect(holds[0]?.n).toBe(3);
  }, 30_000);

  it("frees the slot again once a hold expires", async () => {
    await cleanup();
    await db()
      .insert(schema.slotCapacity)
      .values({ squareLocationId: LOCATION_A, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 1 });

    const [first, second] = await createContenders(2);
    const cart = [{ productId: PRODUCT_ID, quantity: 1 }];

    expect((await claimSlot(first!, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A)).ok).toBe(true);
    expect((await claimSlot(second!, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A)).ok).toBe(false);

    // Abandoned checkout: expire the hold rather than waiting ten minutes.
    await client`UPDATE slot_holds SET expires_at = now() - interval '1 minute' WHERE pickup_date = ${SLOT_DATE}`;

    expect((await claimSlot(second!, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A)).ok).toBe(true);
  }, 30_000);

  it("sweeps expired holds", async () => {
    await cleanup();
    const { sweepExpiredHolds } = await import("./queries");

    const [orderId] = await createContenders(1);
    await db()
      .insert(schema.slotCapacity)
      .values({ squareLocationId: LOCATION_A, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 5 });
    await claimSlot(orderId!, [{ productId: PRODUCT_ID, quantity: 1 }], {
      date: SLOT_DATE,
      time: SLOT_TIME,
    }, LOCATION_A);

    await client`UPDATE slot_holds SET expires_at = now() - interval '1 hour' WHERE pickup_date = ${SLOT_DATE}`;
    expect(await sweepExpiredHolds()).toBeGreaterThanOrEqual(1);

    const remaining = await db().execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM slot_holds WHERE pickup_date = ${SLOT_DATE}`,
    );
    expect(remaining[0]?.n).toBe(0);
  }, 30_000);

  it("books the same date and time independently at different locations", async () => {
    await cleanup();
    await db().insert(schema.slotCapacity).values([
      { squareLocationId: LOCATION_A, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 1 },
      { squareLocationId: LOCATION_B, pickupDate: SLOT_DATE, pickupTime: SLOT_TIME, maxOrders: 1 },
    ]);
    const [toronto] = await createContenders(1, LOCATION_A);
    const [london] = await createContenders(1, LOCATION_B);
    const cart = [{ productId: PRODUCT_ID, quantity: 1 }];

    const [first, second] = await Promise.all([
      claimSlot(toronto!, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_A),
      claimSlot(london!, cart, { date: SLOT_DATE, time: SLOT_TIME }, LOCATION_B),
    ]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  }, 30_000);
});
