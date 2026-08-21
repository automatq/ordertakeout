import "server-only";

import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { inventoryHolds, orderItems, orders } from "@/lib/db/schema";
import { SLOT_HOLD_TTL_MINUTES } from "@/lib/store";

import {
  availableInventoryAfterHolds,
  inventoryShortages,
  normalizeInventoryRequests,
  type InventoryRequest,
  type InventoryShortage,
} from "./map";

type Database = ReturnType<typeof db>;
export type InventoryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Executor = Database | InventoryTransaction;

/** Square normally reflects a completed online sale quickly; keep a safety tail. */
export const PAID_INVENTORY_HOLD_BUFFER_MINUTES = 5;

export interface InventoryHoldReadOptions {
  /** Ignore this order's own live hold while retaining every competing hold. */
  excludeOrderId?: string;
}

export interface ReserveInventoryOptions {
  /** Usually the matching pickup-slot hold expiry. */
  expiresAt?: Date;
}

export type ReserveInventoryResult =
  | { ok: true; expiresAt: Date }
  | { ok: false; shortages: InventoryShortage[] };

export interface ProtectInventoryResult {
  ok: boolean;
  heldVariationIds: string[];
}

/**
 * Stable, unambiguous advisory-lock identities for one location's variations.
 * Exported because the no-deadlock ordering is an invariant worth unit testing.
 */
export function inventoryAdvisoryLockKeys(
  locationId: string,
  requests: readonly InventoryRequest[],
): string[] {
  return normalizeInventoryRequests(requests)
    .map(({ variationId }) =>
      `inventory:${locationId.length}:${locationId}:${variationId.length}:${variationId}`
    )
    .sort();
}

async function loadActiveHoldQuantities(
  exec: Executor,
  locationId: string,
  variationIds: readonly string[],
  options: InventoryHoldReadOptions = {},
): Promise<Map<string, number>> {
  const uniqueVariationIds = [...new Set(variationIds)].sort();
  if (!uniqueVariationIds.length) return new Map();

  const rows = await exec
    .select({
      variationId: inventoryHolds.squareVariationId,
      quantity: sql<string>`COALESCE(SUM(${inventoryHolds.quantity}), 0)::text`,
    })
    .from(inventoryHolds)
    .where(and(
      eq(inventoryHolds.squareLocationId, locationId),
      inArray(inventoryHolds.squareVariationId, uniqueVariationIds),
      sql`${inventoryHolds.expiresAt} > now()`,
      options.excludeOrderId
        ? ne(inventoryHolds.orderId, options.excludeOrderId)
        : undefined,
    ))
    .groupBy(inventoryHolds.squareVariationId);

  return new Map(rows.map((row) => [row.variationId, Number(row.quantity)]));
}

/**
 * Apply uncached reservation state to a caller-supplied Square snapshot.
 *
 * This deliberately lives outside every `use cache` scope. Raw Square counts
 * may be cached for browsing, but a hold created one request ago must affect the
 * very next request.
 */
export async function subtractActiveInventoryHolds(
  locationId: string,
  rawSquareQuantities: ReadonlyMap<string, number>,
  options: InventoryHoldReadOptions = {},
): Promise<Map<string, number>> {
  const held = await loadActiveHoldQuantities(
    db(),
    locationId,
    [...rawSquareQuantities.keys()],
    options,
  );
  return availableInventoryAfterHolds(rawSquareQuantities, held);
}

/** Open a transaction and reserve inventory for an existing local order. */
export async function reserveInventory(
  orderId: string,
  locationId: string,
  requests: readonly InventoryRequest[],
  rawSquareQuantities: ReadonlyMap<string, number>,
  options: ReserveInventoryOptions = {},
): Promise<ReserveInventoryResult> {
  return db().transaction((tx) => reserveInventoryWithin(
    tx,
    orderId,
    locationId,
    requests,
    rawSquareQuantities,
    options,
  ));
}

/**
 * Atomically compare raw Square stock with all competing local holds and claim
 * the requested units.
 *
 * The Square snapshot is fetched by the caller before opening the transaction;
 * network I/O must not happen while database locks are held. Locks are acquired
 * in sorted variation order and are location-scoped, so two checkouts that saw
 * the same final Square unit serialize: the second transaction observes the
 * first one's committed hold and is rejected.
 */
export async function reserveInventoryWithin(
  tx: InventoryTransaction,
  orderId: string,
  locationId: string,
  requests: readonly InventoryRequest[],
  rawSquareQuantities: ReadonlyMap<string, number>,
  options: ReserveInventoryOptions = {},
): Promise<ReserveInventoryResult> {
  if (!orderId || !locationId) {
    throw new TypeError("Inventory reservations require an order id and location id");
  }

  const normalized = normalizeInventoryRequests(requests);
  if (!normalized.length) {
    const expiresAt = options.expiresAt
      ?? new Date(Date.now() + SLOT_HOLD_TTL_MINUTES * 60_000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new RangeError("Inventory hold expiry must be in the future");
    }
    return { ok: true, expiresAt };
  }

  // Sequential acquisition in the globally stable order prevents deadlocks
  // when carts contain the same variations in different presentation orders.
  for (const lockKey of inventoryAdvisoryLockKeys(locationId, normalized)) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  // A transaction may have waited behind another cart. Check the deadline only
  // after every lock is held so we never insert a hold that expired in the queue.
  const expiresAt = options.expiresAt
    ?? new Date(Date.now() + SLOT_HOLD_TTL_MINUTES * 60_000);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new RangeError("Inventory hold expiry must be in the future");
  }

  // Exclude a retry's own row so an idempotent re-reservation replaces rather
  // than double-counts it. Every other order at this location remains visible.
  const held = await loadActiveHoldQuantities(
    tx,
    locationId,
    normalized.map((line) => line.variationId),
    { excludeOrderId: orderId },
  );
  const available = availableInventoryAfterHolds(rawSquareQuantities, held);
  const shortages = inventoryShortages(normalized, available);
  if (shortages.length) return { ok: false, shortages };

  const updatedAt = new Date();
  await tx
    .insert(inventoryHolds)
    .values(normalized.map((line) => ({
      orderId,
      squareVariationId: line.variationId,
      squareLocationId: locationId,
      quantity: line.quantity,
      expiresAt,
      updatedAt,
    })))
    .onConflictDoUpdate({
      target: [inventoryHolds.orderId, inventoryHolds.squareVariationId],
      set: {
        squareLocationId: sql`excluded.square_location_id`,
        quantity: sql`excluded.quantity`,
        expiresAt: sql`excluded.expires_at`,
        updatedAt,
      },
    });

  return { ok: true, expiresAt };
}

/**
 * Convert this order's still-live checkout rows into payment-bound holds.
 *
 * The same location/variation advisory locks used during initial reservation
 * close the expiry boundary: either this transaction extends the old rows
 * first, or a competing checkout reserves the released stock first. It can
 * never do both. `FOR UPDATE` also prevents the housekeeping sweep from
 * deleting a row between validation and extension.
 */
export async function protectInventoryHoldsForPaymentWithin(
  tx: InventoryTransaction,
  orderId: string,
  locationId: string,
  requests: readonly InventoryRequest[],
  protectedUntil: Date,
  now: Date = new Date(),
): Promise<ProtectInventoryResult> {
  if (!orderId || !locationId) {
    throw new TypeError("Payment inventory protection requires an order id and location id");
  }
  if (
    !Number.isFinite(protectedUntil.getTime())
    || protectedUntil.getTime() <= now.getTime()
  ) {
    throw new RangeError("Protected inventory expiry must be in the future");
  }

  const normalized = normalizeInventoryRequests(requests);
  if (!normalized.length) return { ok: true, heldVariationIds: [] };

  for (const lockKey of inventoryAdvisoryLockKeys(locationId, normalized)) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  const variationIds = normalized.map((line) => line.variationId);
  const rows = await tx
    .select({
      variationId: inventoryHolds.squareVariationId,
      quantity: inventoryHolds.quantity,
    })
    .from(inventoryHolds)
    .where(and(
      eq(inventoryHolds.orderId, orderId),
      eq(inventoryHolds.squareLocationId, locationId),
      inArray(inventoryHolds.squareVariationId, variationIds),
      sql`${inventoryHolds.expiresAt} > now()`,
    ))
    .for("update");

  const held = new Map(rows.map((row) => [row.variationId, row.quantity]));
  if (inventoryShortages(normalized, held).length) {
    return { ok: false, heldVariationIds: [...held.keys()].sort() };
  }

  const updatedAt = new Date();
  const updated = await tx
    .update(inventoryHolds)
    .set({ expiresAt: protectedUntil, updatedAt })
    .where(and(
      eq(inventoryHolds.orderId, orderId),
      eq(inventoryHolds.squareLocationId, locationId),
      inArray(inventoryHolds.squareVariationId, variationIds),
      sql`${inventoryHolds.expiresAt} > now()`,
    ))
    .returning({ variationId: inventoryHolds.squareVariationId });

  return {
    ok: updated.length === normalized.length,
    heldVariationIds: updated.map((row) => row.variationId).sort(),
  };
}

/** Restore payment-bound inventory rows to the customer's original checkout deadline. */
export async function restoreInventoryHoldsAfterPaymentAttemptWithin(
  tx: InventoryTransaction,
  orderId: string,
  locationId: string,
  requests: readonly InventoryRequest[],
  expiresAt: Date,
  updatedAt: Date = new Date(),
): Promise<number> {
  const normalized = normalizeInventoryRequests(requests);
  for (const lockKey of inventoryAdvisoryLockKeys(locationId, normalized)) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  const restored = await tx
    .update(inventoryHolds)
    .set({ expiresAt, updatedAt })
    .where(and(
      eq(inventoryHolds.orderId, orderId),
      eq(inventoryHolds.squareLocationId, locationId),
      normalized.length
        ? inArray(
            inventoryHolds.squareVariationId,
            normalized.map((line) => line.variationId),
          )
        : undefined,
    ))
    .returning({ variationId: inventoryHolds.squareVariationId });
  return restored.length;
}

/** Release every variation held by an order inside the caller's transaction. */
export async function releaseInventoryHoldsWithin(
  tx: InventoryTransaction,
  orderId: string,
): Promise<number> {
  const rows = await tx
    .delete(inventoryHolds)
    .where(eq(inventoryHolds.orderId, orderId))
    .returning({ variationId: inventoryHolds.squareVariationId });
  return rows.length;
}

/** Release every variation held by an abandoned or cancelled order. */
export async function releaseInventoryHolds(orderId: string): Promise<number> {
  const rows = await db()
    .delete(inventoryHolds)
    .where(eq(inventoryHolds.orderId, orderId))
    .returning({ variationId: inventoryHolds.squareVariationId });
  return rows.length;
}

/**
 * Convert checkout holds into a short Square-sync buffer after payment.
 *
 * Setting a new deadline both extends a nearly-expired hold and shortens an
 * early checkout's remaining ten-minute window. The unit remains unavailable
 * only long enough for Square's raw inventory count to reflect the sale. Rows
 * are rebuilt from the immutable order-item snapshot if an expiry sweep raced a
 * delayed payment webhook, so that safety buffer does not silently disappear.
 */
export async function retainInventoryHoldsAfterPaymentWithin(
  tx: InventoryTransaction,
  orderId: string,
  paidAt: Date = new Date(),
): Promise<number> {
  const [order, items] = await Promise.all([
    tx
      .select({ locationId: orders.squareLocationId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1),
    tx
      .select({
        variationId: orderItems.squareCatalogObjectId,
        quantity: orderItems.quantity,
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId)),
  ]);
  const locationId = order[0]?.locationId;
  if (!locationId || !items.length) return 0;

  const normalized = normalizeInventoryRequests(items);
  for (const lockKey of inventoryAdvisoryLockKeys(locationId, normalized)) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  const expiresAt = new Date(
    paidAt.getTime() + PAID_INVENTORY_HOLD_BUFFER_MINUTES * 60_000,
  );
  await tx
    .insert(inventoryHolds)
    .values(normalized.map((line) => ({
      orderId,
      squareVariationId: line.variationId,
      squareLocationId: locationId,
      quantity: line.quantity,
      expiresAt,
      updatedAt: paidAt,
    })))
    .onConflictDoUpdate({
      target: [inventoryHolds.orderId, inventoryHolds.squareVariationId],
      set: {
        squareLocationId: sql`excluded.square_location_id`,
        quantity: sql`excluded.quantity`,
        expiresAt: sql`excluded.expires_at`,
        updatedAt: paidAt,
      },
    });
  return normalized.length;
}

/** Standalone form for webhook reconciliation paths without an open transaction. */
export async function retainInventoryHoldsAfterPayment(
  orderId: string,
  paidAt: Date = new Date(),
): Promise<number> {
  return db().transaction((tx) =>
    retainInventoryHoldsAfterPaymentWithin(tx, orderId, paidAt)
  );
}

/** Expired rows are ignored for correctness; this keeps the table bounded. */
export async function sweepExpiredInventoryHolds(): Promise<number> {
  const rows = await db()
    .delete(inventoryHolds)
    .where(sql`${inventoryHolds.expiresAt} <= now()`)
    .returning({ variationId: inventoryHolds.squareVariationId });
  return rows.length;
}
