import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The final-unit race requires two real Postgres connections.
 *
 * Skipped by the hermetic suite; run after migrations with:
 *
 *   TEST_DATABASE_URL=postgresql://localhost:5432/ordertakeout_demo npm test
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;

const LOCATION_A = "TEST_INVENTORY_TORONTO";
const LOCATION_B = "TEST_INVENTORY_LONDON";
const VARIATION_ID = "TEST_FINAL_VARIATION";
const PICKUP_DATE = "2099-12-31";

describeIfDb("inventory reservation under concurrency", () => {
  let db: typeof import("@/lib/db").db;
  let schema: typeof import("@/lib/db/schema");
  let reservations: typeof import("./reservations");
  let client: import("postgres").Sql;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    process.env.STORE_TIMEZONE ??= "America/Toronto";
    process.env.STORE_CURRENCY ??= "CAD";
    process.env.SQUARE_ACCESS_TOKEN ??= "test";
    process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ??= "test";
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ??= "https://example.com/hook";
    process.env.STAFF_DASHBOARD_PASSWORD ??= "test-password";

    ({ db } = await import("@/lib/db"));
    schema = await import("@/lib/db/schema");
    reservations = await import("./reservations");

    const postgres = (await import("postgres")).default;
    client = postgres(TEST_DATABASE_URL!, { prepare: false });
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    if (!TEST_DATABASE_URL) return;
    await cleanup();
    await client.end();
  });

  async function cleanup() {
    await client`DELETE FROM inventory_holds WHERE square_location_id LIKE 'TEST_INVENTORY_%'`;
    await client`DELETE FROM orders WHERE square_location_id LIKE 'TEST_INVENTORY_%'`;
  }

  async function createOrder(orderNumber: string, locationId: string): Promise<string> {
    const [order] = await db()
      .insert(schema.orders)
      .values({
        orderNumber,
        customerName: "Inventory racer",
        customerEmail: "inventory-racer@example.com",
        customerPhone: "+14165550199",
        squareLocationId: locationId,
        pickupDate: PICKUP_DATE,
        pickupTime: "16:00",
        status: "pending_payment",
        subtotalCents: 2500,
        totalCents: 2500,
        currency: "CAD",
      })
      .returning({ id: schema.orders.id });
    if (!order) throw new Error("Failed to create inventory test order");
    await db().insert(schema.orderItems).values({
      orderId: order.id,
      squareCatalogObjectId: VARIATION_ID,
      squareProductId: "TEST_INVENTORY_PRODUCT",
      nameSnapshot: "Test final variation",
      quantity: 1,
      unitPriceCents: 2500,
      totalPriceCents: 2500,
    });
    return order.id;
  }

  it("lets exactly one simultaneous checkout reserve Square's final unit", async () => {
    const [firstOrderId, secondOrderId] = await Promise.all([
      createOrder("IH-RACE-A", LOCATION_A),
      createOrder("IH-RACE-B", LOCATION_A),
    ]);
    const request = [{ variationId: VARIATION_ID, quantity: 1 }];
    const rawSquareSnapshot = new Map([[VARIATION_ID, 1]]);

    const results = await Promise.all([
      reservations.reserveInventory(
        firstOrderId,
        LOCATION_A,
        request,
        rawSquareSnapshot,
      ),
      reservations.reserveInventory(
        secondOrderId,
        LOCATION_A,
        request,
        rawSquareSnapshot,
      ),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      {
        ok: false,
        shortages: [{ variationId: VARIATION_ID, quantity: 1, available: 0 }],
      },
    ]);
  }, 30_000);

  it("allows the same raw unit count to be reserved independently by location", async () => {
    const [torontoOrderId, londonOrderId] = await Promise.all([
      createOrder("IH-LOC-A", LOCATION_A),
      createOrder("IH-LOC-B", LOCATION_B),
    ]);
    const request = [{ variationId: VARIATION_ID, quantity: 1 }];
    const rawSquareSnapshot = new Map([[VARIATION_ID, 1]]);

    const [toronto, london] = await Promise.all([
      reservations.reserveInventory(
        torontoOrderId,
        LOCATION_A,
        request,
        rawSquareSnapshot,
      ),
      reservations.reserveInventory(
        londonOrderId,
        LOCATION_B,
        request,
        rawSquareSnapshot,
      ),
    ]);

    expect(toronto.ok).toBe(true);
    expect(london.ok).toBe(true);
  }, 30_000);

  it("excludes only the current order and supports retain/release lifecycle", async () => {
    const orderId = await createOrder("IH-LIFECYCLE", LOCATION_A);
    const request = [{ variationId: VARIATION_ID, quantity: 1 }];
    const rawSquareSnapshot = new Map([[VARIATION_ID, 1]]);

    expect((await reservations.reserveInventory(
      orderId,
      LOCATION_A,
      request,
      rawSquareSnapshot,
    )).ok).toBe(true);

    expect(await reservations.subtractActiveInventoryHolds(
      LOCATION_A,
      rawSquareSnapshot,
    )).toEqual(new Map([[VARIATION_ID, 0]]));
    expect(await reservations.subtractActiveInventoryHolds(
      LOCATION_A,
      rawSquareSnapshot,
      { excludeOrderId: orderId },
    )).toEqual(new Map([[VARIATION_ID, 1]]));

    const paidAt = new Date();
    expect(await reservations.retainInventoryHoldsAfterPayment(orderId, paidAt)).toBe(1);
    const [hold] = await db()
      .select({ expiresAt: schema.inventoryHolds.expiresAt })
      .from(schema.inventoryHolds)
      .where(eq(schema.inventoryHolds.orderId, orderId));
    expect(hold?.expiresAt.getTime()).toBe(
      paidAt.getTime() + reservations.PAID_INVENTORY_HOLD_BUFFER_MINUTES * 60_000,
    );

    expect(await reservations.releaseInventoryHolds(orderId)).toBe(1);
    expect(await reservations.subtractActiveInventoryHolds(
      LOCATION_A,
      rawSquareSnapshot,
    )).toEqual(new Map([[VARIATION_ID, 1]]));
  });
});
