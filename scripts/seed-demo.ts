/**
 * Seed a database for the demo.
 *
 * Idempotent: safe to re-run. It upserts the ordering rules and only creates
 * sample orders if there aren't any, so re-seeding doesn't pile up duplicates.
 *
 *   DATABASE_URL=... STORE_TIMEZONE=... npx tsx scripts/seed-demo.ts
 */

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DEMO_PRODUCTS, DEMO_PRODUCT_RULES } from "../lib/demo/catalog";
import * as schema from "../lib/db/schema";
import { addCalendarDays, storeToday } from "../lib/scheduling/time";

const DATABASE_URL = process.env.DATABASE_URL;
const STORE_TIMEZONE = process.env.STORE_TIMEZONE ?? "America/Los_Angeles";

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = postgres(DATABASE_URL, { prepare: false });
const db = drizzle(client, { schema });

const CUSTOMERS = [
  { name: "Maria Santos", email: "maria@example.com", phone: "+15551234567" },
  { name: "Danilo Cruz", email: "danilo@example.com", phone: "+15552345678" },
  { name: "Grace Reyes", email: "grace@example.com", phone: "+15553456789" },
  { name: "Ben Aquino", email: "ben@example.com", phone: "+15554567890" },
];

const ORDER_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function orderNumber(seed: number): string {
  let code = "";
  let value = seed * 2_654_435_761;
  for (let i = 0; i < 6; i++) {
    code += ORDER_ALPHABET[Math.abs(value) % ORDER_ALPHABET.length];
    value = Math.floor(value / ORDER_ALPHABET.length) + seed * 31;
  }
  return `PT-${code}`;
}

async function main() {
  const today = storeToday(new Date(), STORE_TIMEZONE);
  console.log(`Seeding demo data (store date ${today}, ${STORE_TIMEZONE})`);

  // --- Ordering rules -------------------------------------------------------
  for (const rule of DEMO_PRODUCT_RULES) {
    const product = DEMO_PRODUCTS.find((p) => p.id === rule.productId);
    const values = {
      squareCatalogObjectId: rule.productId,
      slug: rule.slug,
      leadTimeDays: rule.leadTimeDays,
      orderCutoffTime: rule.orderCutoffTime,
      allowedPickupTimes: [...rule.allowedPickupTimes],
      maxUnitsPerDay: rule.maxUnitsPerDay,
      isOrderable: true,
      sortOrder: rule.sortOrder,
      descriptionMd: product?.description ?? null,
      updatedAt: new Date(),
    };

    await db
      .insert(schema.productsConfig)
      .values(values)
      .onConflictDoUpdate({ target: schema.productsConfig.squareCatalogObjectId, set: values });
  }
  console.log(`  ${DEMO_PRODUCT_RULES.length} product rules`);

  // --- A closure date, so the picker visibly skips a day --------------------
  const closure = addCalendarDays(today, 3);
  await db
    .insert(schema.blackoutDates)
    .values({ date: closure, reason: "Demo: staff training day" })
    .onConflictDoNothing();
  console.log(`  closure on ${closure}`);

  // --- A tight slot cap, so "fully booked" is visible in the picker ---------
  const busyDate = addCalendarDays(today, 1);
  await db
    .insert(schema.slotCapacity)
    .values({ pickupDate: busyDate, pickupTime: "16:00", maxOrders: 2, notes: "Demo" })
    .onConflictDoUpdate({
      target: [schema.slotCapacity.pickupDate, schema.slotCapacity.pickupTime],
      set: { maxOrders: 2 },
    });
  console.log(`  4:00 PM on ${busyDate} capped at 2 orders`);

  // --- Sample orders, only if the table is empty ----------------------------
  const counted = await db.execute<{ count: string }>(
    sql`select count(*)::text as count from ${schema.orders}`,
  );
  const count = counted[0]?.count ?? "0";

  if (Number(count) > 0) {
    console.log(`  ${count} orders already present — skipping sample orders`);
    await client.end();
    return;
  }

  const samples = [
    { customer: 0, date: today, time: "16:00", status: "paid" as const, variant: 0, qty: 2 },
    { customer: 1, date: today, time: "17:00", status: "preparing" as const, variant: 2, qty: 1 },
    { customer: 2, date: today, time: "18:00", status: "ready" as const, variant: 4, qty: 3 },
    { customer: 3, date: busyDate, time: "16:00", status: "paid" as const, variant: 6, qty: 1 },
    { customer: 0, date: busyDate, time: "16:00", status: "paid" as const, variant: 1, qty: 4 },
  ];

  const allVariants = DEMO_PRODUCTS.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );

  for (const [index, sample] of samples.entries()) {
    const customer = CUSTOMERS[sample.customer]!;
    const entry = allVariants[sample.variant]!;
    const lineTotal = entry.variant.priceCents * sample.qty;
    const now = new Date();

    const [order] = await db
      .insert(schema.orders)
      .values({
        orderNumber: orderNumber(index + 1),
        squareOrderId: `DEMO_ORDER_SEED_${index}`,
        squarePaymentId: `DEMO_PAY_SEED_${index}`,
        customerName: customer.name,
        customerEmail: customer.email,
        customerPhone: customer.phone,
        pickupDate: sample.date,
        pickupTime: sample.time,
        status: sample.status,
        subtotalCents: lineTotal,
        totalCents: lineTotal,
        currency: "USD",
        customerNote: index === 1 ? "Please label the tray — it's a surprise!" : null,
        paidAt: now,
        readyAt: sample.status === "ready" ? now : null,
      })
      .returning({ id: schema.orders.id });

    await db.insert(schema.orderItems).values({
      orderId: order!.id,
      squareCatalogObjectId: entry.variant.id,
      nameSnapshot: `${entry.product.name} — ${entry.variant.name}`,
      quantity: sample.qty,
      unitPriceCents: entry.variant.priceCents,
      totalPriceCents: lineTotal,
    });
  }
  console.log(`  ${samples.length} sample orders`);

  await client.end();
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
