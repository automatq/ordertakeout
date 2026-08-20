/**
 * One-time post-migration backfill for orders created before multi-location
 * checkout. Run with `npm run db:backfill-legacy-location` after setting the
 * LEGACY_SQUARE_LOCATION_ID in the deployment environment.
 */
import { eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { blackoutDates, orderItems, orders, slotCapacity, slotHolds } from "@/lib/db/schema";
import { getStoreCatalog } from "@/lib/catalog/server";
import { getStoreLocation } from "@/lib/locations/server";
import { squareLocationId } from "@/lib/square/client";

const legacyLocationId = squareLocationId();
if (!legacyLocationId) throw new Error("Set LEGACY_SQUARE_LOCATION_ID before running this backfill.");
const location = await getStoreLocation(legacyLocationId);
if (!location) throw new Error("The configured legacy Square location is not active.");

const updatedOrders = await db()
  .update(orders)
  .set({
    squareLocationId: location.id,
    pickupLocationName: location.name,
    pickupLocationAddress: location.address,
    pickupLocationCity: location.city,
    pickupLocationPhone: location.phone,
    pickupLocationTimezone: location.timezone,
    pickupLocationHours: location.businessHours,
  })
  .where(isNull(orders.squareLocationId))
  .returning({ id: orders.id });
const updatedHolds = await db()
  .update(slotHolds)
  .set({ squareLocationId: location.id })
  .where(isNull(slotHolds.squareLocationId))
  .returning({ id: slotHolds.id });

const updatedBlackouts = await db()
  .update(blackoutDates)
  .set({ squareLocationId: location.id })
  .where(isNull(blackoutDates.squareLocationId))
  .returning({ id: blackoutDates.id });
const updatedSlots = await db()
  .update(slotCapacity)
  .set({ squareLocationId: location.id })
  .where(isNull(slotCapacity.squareLocationId))
  .returning({ id: slotCapacity.id });

const catalog = await getStoreCatalog();
const productByVariation = new Map(
  [...catalog.products, ...catalog.unconfigured].flatMap((product) =>
    product.variants.map((variant) => [variant.id, product.id] as const),
  ),
);
const legacyItems = await db()
  .select({ id: orderItems.id, variationId: orderItems.squareCatalogObjectId })
  .from(orderItems)
  .where(isNull(orderItems.squareProductId));
let updatedItems = 0;
for (const item of legacyItems) {
  const productId = productByVariation.get(item.variationId);
  if (!productId) continue;
  await db().update(orderItems).set({ squareProductId: productId }).where(eq(orderItems.id, item.id));
  updatedItems += 1;
}

console.log(`Backfilled ${updatedOrders.length} orders, ${updatedHolds.length} holds, ${updatedBlackouts.length} closures, ${updatedSlots.length} slot limits, and ${updatedItems} line items for ${location.name}.`);
