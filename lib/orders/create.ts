import "server-only";

import { after } from "next/server";

import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import { resolveCart, toSchedulingCart, type CartItem } from "@/lib/catalog/cart";
import { getOrderableProducts } from "@/lib/catalog/server";
import { db } from "@/lib/db";
import { customerAccounts, loyaltyEntries, orderItems, orders, slotHolds } from "@/lib/db/schema";
import { REWARD_DISCOUNT_CENTS, REWARD_POINTS } from "@/lib/accounts/loyalty";
import { reportError } from "@/lib/monitoring/report";
import { reserveSlotWithin } from "@/lib/scheduling/queries";
import { slotKey, type SelectionRejection } from "@/lib/scheduling/availability";
import { normalizeTime, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { getStoreLocation } from "@/lib/locations/server";
import { inventoryShortages, type InventoryShortage } from "@/lib/inventory/map";
import {
  getFreshInventoryQuantities,
  getFreshRawInventoryQuantities,
} from "@/lib/inventory/server";
import {
  protectInventoryHoldsForPaymentWithin,
  releaseInventoryHoldsWithin,
  reserveInventoryWithin,
  restoreInventoryHoldsAfterPaymentAttemptWithin,
  retainInventoryHoldsAfterPaymentWithin,
  subtractActiveInventoryHolds,
} from "@/lib/inventory/reservations";
import {
  cancelSquarePaymentAttempt,
  createSquareDraftOrder,
  createSquarePayment,
} from "@/lib/square/orders";
import { SLOT_HOLD_TTL_MINUTES } from "@/lib/store";

import { generateOrderNumber } from "./number";
import { createOrderAccessToken } from "./access";
import {
  createPaymentAttemptKey,
  isPaymentReservationProtected,
  PAYMENT_ATTEMPT_LEASE_MS,
  PAYMENT_ATTEMPT_RECOVERY_AFTER_MS,
  paymentAttemptMarker,
  paymentReservationProtectedUntil,
} from "./payment-state";

const ORDER_NUMBER_UNIQUE_CONSTRAINT = "orders_order_number_key";
const MAX_ORDER_NUMBER_INSERT_ATTEMPTS = 3;
export function shouldReleasePaymentClaim(code: string): boolean {
  return ![
    "SQUARE_ERROR",
    "NO_PAYMENT",
    "NO_PAYMENT_STATUS",
    "PAYMENT_APPROVED",
    "PAYMENT_PENDING",
    "PAYMENT_UNKNOWN",
  ].includes(code);
}

/** True only for the unique index that protects public order references. */
export function isOrderNumberUniqueViolation(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;

  const error = cause as { code?: unknown; constraint?: unknown };
  return error.code === "23505" && error.constraint === ORDER_NUMBER_UNIQUE_CONSTRAINT;
}

/**
 * Checkout orchestration.
 *
 * Split deliberately into two steps with the card entry in between:
 *
 *   1. createPendingOrder — reserve the slot and record the order, unpaid
 *   2. (browser tokenises the card via the Square Web Payments SDK)
 *   3. payForOrder       — charge, then mark paid
 *
 * Reserving before charging is what stops two customers paying for the last slot
 * at 4 PM. The reservation expires on its own, so an abandoned checkout releases
 * the slot without a compensating action.
 */

export interface CustomerDetails {
  name: string;
  email: string;
  phone: string;
}

export type CreateOrderFailure =
  | { kind: "empty_cart" }
  | { kind: "catalog_unavailable" }
  | { kind: "unknown_items"; variantIds: string[] }
  | {
      kind: "insufficient_stock";
      shortages: { variantId: string; requested: number; available: number }[];
    }
  | { kind: "slot_rejected"; rejection: SelectionRejection }
  | {
      /** Square priced the order differently from what the customer was shown. */
      kind: "price_changed";
      shownCents: number;
      actualCents: number;
    }
  | { kind: "reward_unavailable" };

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      subtotalCents: number;
      taxCents: number;
      totalCents: number;
      currency: string;
      holdExpiresAt: Date;
      /** Authorizes this browser to release the still-unpaid reservation. */
      reservationToken: string;
    }
  | { ok: false; failure: CreateOrderFailure };

export async function createPendingOrder(input: {
  locationId: string;
  cart: readonly CartItem[];
  pickup: { date: StoreDate; time: StoreTime };
  customer: CustomerDetails;
  note?: string;
  /** Total shown to the customer, in cents — compared against Square's own. */
  expectedTotalCents: number;
  /** Set only when this signed-in account has chosen an available reward. */
  accountId?: string;
  redeemReward?: boolean;
}): Promise<CreateOrderResult> {
  if (input.cart.length === 0) {
    return { ok: false, failure: { kind: "empty_cart" } };
  }

  const catalog = await getOrderableProducts();
  if (catalog.error) {
    return { ok: false, failure: { kind: "catalog_unavailable" } };
  }

  // Prices come from the catalog, never from the request body.
  const resolved = resolveCart(input.cart, catalog.products);
  if (!resolved.ok) {
    return { ok: false, failure: { kind: "unknown_items", variantIds: resolved.unknownVariantIds } };
  }

  const location = await getStoreLocation(input.locationId);
  if (!location) return { ok: false, failure: { kind: "catalog_unavailable" } };

  // Hobby deployments can run the housekeeping cron only once per day. Clear
  // one stale payment-bound reservation for this location before it can reject
  // the next real customer; the cron remains the no-traffic backstop.
  await recoverStalePaymentAttempts({ limit: 1, locationId: location.id }).catch((cause) => {
    reportError("checkout", "stale payment recovery failed", cause, { locationId: location.id });
  });

  const rawInventory = await getFreshRawInventoryQuantities(
    location.id,
    resolved.lines.map((line) => line.variant.id),
  );
  const inventory = await subtractActiveInventoryHolds(location.id, rawInventory);
  const shortages = inventoryShortages(
    resolved.lines.map((line) => ({ variationId: line.variant.id, quantity: line.quantity })),
    inventory,
  );
  if (shortages.length) {
    return {
      ok: false,
      failure: {
        kind: "insufficient_stock",
        shortages: shortages.map((line) => ({
          variantId: line.variationId,
          requested: line.quantity,
          available: line.available,
        })),
      },
    };
  }

  const pickup = { date: input.pickup.date, time: normalizeTime(input.pickup.time) };
  const schedulingCart = toSchedulingCart(resolved.lines);
  const rewardDiscountCents = input.redeemReward ? REWARD_DISCOUNT_CENTS : 0;
  if (rewardDiscountCents && (!input.accountId || resolved.subtotalCents < rewardDiscountCents)) {
    return { ok: false, failure: { kind: "reward_unavailable" } };
  }
  let orderNumber: string | undefined;
  let created: { orderId: string; expiresAt: Date } | undefined;

  // Order, line items and slot hold commit together. A hold pointing at an order
  // that failed to insert would block a pickup slot for nothing. The database
  // unique index is the final collision guarantee; retry only that conflict.
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_INSERT_ATTEMPTS; attempt += 1) {
    const candidateOrderNumber = generateOrderNumber();

    try {
      created = await db().transaction(async (tx) => {
        if (input.redeemReward && input.accountId) {
          // Serialize redemptions for this account. A balance check outside this
          // lock would let two tabs spend the same 100 points.
          await tx.execute(sql`select id from ${customerAccounts} where ${customerAccounts.id} = ${input.accountId} for update`);
          const [balance] = await tx.select({
            points: sql<number>`coalesce(sum(${loyaltyEntries.points}), 0)`,
          }).from(loyaltyEntries).where(eq(loyaltyEntries.customerAccountId, input.accountId));
          if (Number(balance?.points ?? 0) < REWARD_POINTS) throw new RewardUnavailableError();
        }
        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber: candidateOrderNumber,
            customerName: input.customer.name,
            customerEmail: input.customer.email,
            customerPhone: input.customer.phone,
            customerAccountId: input.accountId ?? null,
            squareLocationId: location.id,
            ...{
              pickupLocationName: location.name,
              pickupLocationAddress: location.address,
              pickupLocationCity: location.city,
              pickupLocationPhone: location.phone,
              pickupLocationTimezone: location.timezone,
              pickupLocationHours: location.businessHours,
            },
            pickupDate: pickup.date,
            pickupTime: pickup.time,
            status: "pending_payment",
            subtotalCents: resolved.subtotalCents,
            totalCents: resolved.subtotalCents,
            currency: resolved.currency,
            customerNote: input.note ?? null,
          })
          .returning({ id: orders.id });

        if (!order) throw new Error("Failed to insert order");

        await tx.insert(orderItems).values(
          resolved.lines.map((line) => ({
            orderId: order.id,
            squareCatalogObjectId: line.variant.id,
            squareProductId: line.product.id,
            nameSnapshot: `${line.product.name} — ${line.variant.name}`,
            quantity: line.quantity,
            unitPriceCents: line.variant.priceCents,
            totalPriceCents: line.lineTotalCents,
          })),
        );

        const claim = await reserveSlotWithin(tx, order.id, schedulingCart, pickup, location.id);
        if (!claim.ok) {
          // Rolls back the order and its items — nothing partial survives.
          throw new SlotRejectedError(claim.rejection);
        }

        const inventoryClaim = await reserveInventoryWithin(
          tx,
          order.id,
          location.id,
          resolved.lines.map((line) => ({
            variationId: line.variant.id,
            quantity: line.quantity,
          })),
          rawInventory,
          { expiresAt: claim.expiresAt },
        );
        if (!inventoryClaim.ok) {
          // The surrounding transaction rolls back the order, items and slot
          // hold together; no partial reservation survives.
          throw new InventoryRejectedError(inventoryClaim.shortages);
        }

        if (input.redeemReward && input.accountId) {
          await tx.insert(loyaltyEntries).values({
            customerAccountId: input.accountId,
            orderId: order.id,
            kind: "redeemed",
            points: -REWARD_POINTS,
          });
        }

        return { orderId: order.id, expiresAt: claim.expiresAt };
      });
      orderNumber = candidateOrderNumber;
      break;
    } catch (cause) {
      if (cause instanceof RewardUnavailableError) {
        return { ok: false, failure: { kind: "reward_unavailable" } };
      }
      if (cause instanceof SlotRejectedError) {
        return { ok: false, failure: { kind: "slot_rejected", rejection: cause.rejection } };
      }
      if (cause instanceof InventoryRejectedError) {
        return {
          ok: false,
          failure: {
            kind: "insufficient_stock",
            shortages: cause.shortages.map((line) => ({
              variantId: line.variationId,
              requested: line.quantity,
              available: line.available,
            })),
          },
        };
      }
      if (isOrderNumberUniqueViolation(cause) && attempt + 1 < MAX_ORDER_NUMBER_INSERT_ATTEMPTS) {
        continue;
      }
      throw cause;
    }
  }

  if (!created || !orderNumber) {
    throw new Error("Could not allocate a unique order number");
  }

  // Square prices the order from its own catalog. Done outside the transaction:
  // an external call must never be made while holding database locks.
  let draft: Awaited<ReturnType<typeof createSquareDraftOrder>>;
  try {
    draft = await createSquareDraftOrder({
      locationId: location.id,
      orderNumber,
      lines: resolved.lines,
      pickup,
      customer: input.customer,
      note: input.note ?? null,
      timeZone: location.timezone ?? undefined,
      rewardDiscountCents,
    });
  } catch (cause) {
    // A failed Square/network call must not leave a live hold consuming this
    // store's capacity for the rest of its TTL.
    await abandonOrder(created.orderId).catch((cleanupCause) => {
      reportError("checkout", "could not release a failed Square draft hold", cleanupCause);
    });
    throw cause;
  }

  // If Square's total disagrees with what the customer was shown — because a
  // price changed after our catalog cache was written — stop. Charging a
  // different number than the one on screen is never acceptable, even if it's
  // lower.
  if (draft.subtotalCents !== input.expectedTotalCents) {
    await abandonOrder(created.orderId);
    return {
      ok: false,
      failure: {
        kind: "price_changed",
        shownCents: input.expectedTotalCents,
        actualCents: draft.subtotalCents,
      },
    };
  }

  try {
    const linked = await db()
      .update(orders)
      .set({
        squareOrderId: draft.squareOrderId,
        subtotalCents: draft.subtotalCents,
        taxCents: draft.taxCents,
        totalCents: draft.totalCents,
        currency: draft.currency,
        updatedAt: new Date(),
      })
      .where(and(eq(orders.id, created.orderId), eq(orders.status, "pending_payment")))
      .returning({ id: orders.id });
    if (!linked.length) throw new Error("Pending order changed before its Square draft was linked");
  } catch (cause) {
    await abandonOrder(created.orderId).catch((cleanupCause) => {
      reportError("checkout", "could not release an unlinked Square draft hold", cleanupCause);
    });
    throw cause;
  }

  return {
    ok: true,
    orderId: created.orderId,
    orderNumber,
    subtotalCents: draft.subtotalCents,
    taxCents: draft.taxCents,
    totalCents: draft.totalCents,
    currency: draft.currency,
    holdExpiresAt: created.expiresAt,
    reservationToken: createOrderAccessToken(created.orderId, orderNumber),
  };
}

class SlotRejectedError extends Error {
  constructor(readonly rejection: SelectionRejection) {
    super("Pickup slot rejected");
    this.name = "SlotRejectedError";
  }
}

class InventoryRejectedError extends Error {
  constructor(readonly shortages: InventoryShortage[]) {
    super("Location inventory was claimed by another checkout");
    this.name = "InventoryRejectedError";
  }
}

class RewardUnavailableError extends Error {
  constructor() {
    super("Reward is no longer available");
    this.name = "RewardUnavailableError";
  }
}

export type PayResult =
  | { ok: true; orderNumber: string; accessToken: string }
  | {
      ok: false;
      code: string;
      message: string;
      /** The finite checkout deadline restored after a definitive failure. */
      holdExpiresAt?: Date;
      /** True when the backend owns non-expiring holds pending Square resolution. */
      reservationProtected?: boolean;
    };

type PaymentLine = { variationId: string; quantity: number };

type PaymentAttemptClaim = {
  attemptKey: string;
  sourceId: string;
  paymentMarker: string;
  checkoutExpiresAt: Date;
};

class PaymentReservationExpiredError extends Error {
  constructor() {
    super("Payment reservation expired before it could be protected");
    this.name = "PaymentReservationExpiredError";
  }
}

/**
 * Atomically own this payment attempt and convert both local reservation types
 * to payment-bound holds before crossing Square's network boundary.
 */
export async function claimPaymentAttempt(
  order: typeof orders.$inferSelect,
  items: readonly PaymentLine[],
  sourceId: string,
): Promise<PaymentAttemptClaim | null> {
  const locationId = order.squareLocationId;
  if (!locationId) throw new PaymentReservationExpiredError();

  const now = new Date();
  const staleBefore = new Date(now.getTime() - PAYMENT_ATTEMPT_LEASE_MS);
  const paymentMarker = paymentAttemptMarker(order.id);
  // Deploy-safe fallback for a marker created before payment_attempt_key was
  // introduced. That version sent the order UUID itself to Square.
  const legacyAttempt = order.squarePaymentId === paymentMarker && !order.paymentAttemptKey;
  const attemptKey = order.paymentAttemptKey
    ?? (legacyAttempt ? order.id : createPaymentAttemptKey());
  const attemptSourceId = order.paymentAttemptSourceId ?? (legacyAttempt ? null : sourceId);
  // The pre-migration code did not persist Square's opaque source token. It is
  // unsafe to reuse its old key with a newly tokenized source. The webhook or
  // stale-attempt cancellation path must reconcile that legacy attempt.
  if (!attemptSourceId) return null;

  try {
    return await db().transaction(async (tx) => {
      const claimed = await tx
        .update(orders)
        .set({
          squarePaymentId: paymentMarker,
          paymentAttemptKey: attemptKey,
          paymentAttemptSourceId: attemptSourceId,
          paymentAttemptStartedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(orders.id, order.id),
          eq(orders.status, "pending_payment"),
          or(
            and(
              isNull(orders.squarePaymentId),
              isNull(orders.paymentAttemptKey),
              isNull(orders.paymentAttemptSourceId),
            ),
            order.paymentAttemptKey
              ? and(
                  eq(orders.squarePaymentId, paymentMarker),
                  eq(orders.paymentAttemptKey, order.paymentAttemptKey),
                  eq(orders.paymentAttemptSourceId, attemptSourceId),
                  or(
                    isNull(orders.paymentAttemptStartedAt),
                    lt(orders.paymentAttemptStartedAt, staleBefore),
                  ),
                )
              : undefined,
            legacyAttempt
              ? and(
                  eq(orders.squarePaymentId, paymentMarker),
                  isNull(orders.paymentAttemptKey),
                  lt(orders.updatedAt, staleBefore),
                )
              : undefined,
          ),
        ))
        .returning({ id: orders.id });
      if (!claimed.length) return null;

      // Match reserveSlotWithin's exact advisory key. A competing checkout that
      // sees the old deadline expire must serialize before either reservation
      // can be accepted.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${locationId}:${slotKey(order.pickupDate, order.pickupTime)}`}))`);

      const [hold] = await tx
        .select({
          id: slotHolds.id,
          expiresAt: slotHolds.expiresAt,
          createdAt: slotHolds.createdAt,
        })
        .from(slotHolds)
        .where(and(
          eq(slotHolds.orderId, order.id),
          sql`${slotHolds.expiresAt} > now()`,
        ))
        .limit(1)
        .for("update");
      if (!hold) throw new PaymentReservationExpiredError();

      const checkoutExpiresAt = isPaymentReservationProtected(hold.expiresAt)
        ? new Date(hold.createdAt.getTime() + SLOT_HOLD_TTL_MINUTES * 60_000)
        : hold.expiresAt;
      const protectedUntil = paymentReservationProtectedUntil();
      const inventory = await protectInventoryHoldsForPaymentWithin(
        tx,
        order.id,
        locationId,
        items,
        protectedUntil,
        now,
      );
      if (!inventory.ok) throw new PaymentReservationExpiredError();

      const extended = await tx
        .update(slotHolds)
        .set({ expiresAt: protectedUntil })
        .where(and(
          eq(slotHolds.id, hold.id),
          eq(slotHolds.orderId, order.id),
          sql`${slotHolds.expiresAt} > now()`,
        ))
        .returning({ id: slotHolds.id });
      if (!extended.length) throw new PaymentReservationExpiredError();

      return {
        attemptKey,
        sourceId: attemptSourceId,
        paymentMarker,
        checkoutExpiresAt,
      };
    });
  } catch (cause) {
    if (cause instanceof PaymentReservationExpiredError) return null;
    throw cause;
  }
}

export async function restoreAfterDefinitivePaymentFailure(
  orderId: string,
  locationId: string,
  items: readonly PaymentLine[],
  claim: PaymentAttemptClaim,
): Promise<Date | undefined> {
  return db().transaction(async (tx) => {
    const now = new Date();
    const released = await tx
      .update(orders)
      .set({
        squarePaymentId: null,
        paymentAttemptKey: null,
        paymentAttemptSourceId: null,
        paymentAttemptStartedAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(orders.id, orderId),
        eq(orders.status, "pending_payment"),
        eq(orders.squarePaymentId, claim.paymentMarker),
        eq(orders.paymentAttemptKey, claim.attemptKey),
      ))
      .returning({ id: orders.id });
    if (!released.length) return undefined;

    if (claim.checkoutExpiresAt.getTime() <= now.getTime()) {
      await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
      await releaseInventoryHoldsWithin(tx, orderId);
      return undefined;
    }

    await tx
      .update(slotHolds)
      .set({ expiresAt: claim.checkoutExpiresAt })
      .where(eq(slotHolds.orderId, orderId));
    await restoreInventoryHoldsAfterPaymentAttemptWithin(
      tx,
      orderId,
      locationId,
      items,
      claim.checkoutExpiresAt,
      now,
    );
    return claim.checkoutExpiresAt;
  });
}

/**
 * Charge a pending order and mark it paid.
 *
 * The window between "Square took the money" and "our database says paid" is the
 * one genuinely dangerous moment in checkout. Three things narrow it:
 *
 *   - Each logical attempt has a durable Square idempotency key. Ambiguous
 *     retries reuse it; a definitive decline clears it so corrected card
 *     details get a fresh attempt.
 *   - The pickup and inventory holds become payment-bound before Square is
 *     called, so their checkout deadline cannot pass during capture.
 *   - The database write happens immediately after and is a single transaction.
 *   - If that write still fails, the `payment.updated` webhook (Phase 7)
 *     reconciles the order independently. The payment id is recoverable from
 *     Square by the same idempotency key, so nothing is lost.
 */
export async function payForOrder(orderId: string, sourceId: string): Promise<PayResult> {
  const [order] = await db().select().from(orders).where(eq(orders.id, orderId)).limit(1);

  if (!order) {
    return { ok: false, code: "NOT_FOUND", message: "Order not found." };
  }
  if (order.status !== "pending_payment") {
    // Already paid: treat as success so a double-submitted form is harmless.
    return order.status === "canceled"
      ? { ok: false, code: "CANCELED", message: "This order was cancelled." }
      : { ok: true, orderNumber: order.orderNumber, accessToken: createOrderAccessToken(order.id, order.orderNumber) };
  }
  if (!order.squareOrderId) {
    return { ok: false, code: "NO_SQUARE_ORDER", message: "Order was not registered with Square." };
  }

  const locationId = order.squareLocationId;
  if (!locationId) {
    return { ok: false, code: "LOCATION_UNAVAILABLE", message: "This pickup location is no longer available." };
  }

  const hasPersistedAttempt = Boolean(
    order.paymentAttemptKey
    || order.squarePaymentId === paymentAttemptMarker(order.id),
  );
  if (!hasPersistedAttempt && !(await getStoreLocation(locationId))) {
    return { ok: false, code: "LOCATION_UNAVAILABLE", message: "This pickup location is no longer available." };
  }

  // Inventory can change while the card form is open or through the POS. Read
  // it again immediately before charging so a stale browsing result never
  // becomes a paid oversell.
  const items = await db()
    .select({ variationId: orderItems.squareCatalogObjectId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  // Once Square might have received an attempt, its durable idempotency key is
  // the only safe retry path. Square's own inventory may already reflect the
  // ambiguous payment, so re-running a fresh-stock gate here would strand a
  // captured order as a false sell-out.
  if (!hasPersistedAttempt) {
    const inventory = await getFreshInventoryQuantities(
      locationId,
      items.map((item) => item.variationId),
      { excludeOrderId: orderId },
    );
    const shortages = inventoryShortages(items, inventory);
    if (shortages.length) {
      await abandonOrder(orderId);
      return {
        ok: false,
        code: "STOCK_CHANGED",
        message: "An item sold out while you were checking out. Your card was not charged; please review your order.",
      };
    }
  }

  const claim = await claimPaymentAttempt(order, items, sourceId);
  if (!claim) {
    const [fresh] = await db()
      .select({
        status: orders.status,
        orderNumber: orders.orderNumber,
        paymentAttemptKey: orders.paymentAttemptKey,
        squarePaymentId: orders.squarePaymentId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (fresh && fresh.status !== "pending_payment" && fresh.status !== "canceled") {
      return {
        ok: true,
        orderNumber: fresh.orderNumber,
        accessToken: createOrderAccessToken(order.id, fresh.orderNumber),
      };
    }
    return fresh?.status === "canceled"
      ? { ok: false, code: "CANCELED", message: "This order was cancelled." }
      : fresh?.paymentAttemptKey || fresh?.squarePaymentId === paymentAttemptMarker(orderId)
        ? {
          ok: false,
          code: "PAYMENT_IN_PROGRESS",
          message: "This payment is already processing. Please wait a moment and try again; you will not be charged twice.",
          reservationProtected: true,
        }
        : {
            ok: false,
            code: "HOLD_EXPIRED",
            message: "Your pickup time was released because checkout took too long. Please choose a time again.",
          };
  }

  const payment = await createSquarePayment({
    idempotencyKey: claim.attemptKey,
    locationId,
    orderId,
    squareOrderId: order.squareOrderId,
    amountCents: order.totalCents,
    currency: order.currency,
    sourceId: claim.sourceId,
    buyerEmail: order.customerEmail,
    orderNumber: order.orderNumber,
  });

  if (!payment.ok) {
    if (shouldReleasePaymentClaim(payment.code)) {
      const holdExpiresAt = await restoreAfterDefinitivePaymentFailure(
        orderId,
        locationId,
        items,
        claim,
      );
      return {
        ok: false,
        code: payment.code,
        message: payment.message,
        ...(holdExpiresAt ? { holdExpiresAt } : {}),
      };
    }
    return {
      ok: false,
      code: payment.code,
      message: payment.message,
      reservationProtected: true,
    };
  }

  const paidAt = new Date();
  let updated: { id: string }[];
  try {
    updated = await db().transaction(async (tx) => {
      const rows = await tx
        .update(orders)
        .set({
          status: "paid",
          squarePaymentId: payment.paymentId,
          paymentAttemptKey: null,
          paymentAttemptSourceId: null,
          paymentAttemptStartedAt: null,
          paidAt,
          updatedAt: paidAt,
        })
        .where(and(
          eq(orders.id, orderId),
          eq(orders.status, "pending_payment"),
          eq(orders.squarePaymentId, claim.paymentMarker),
          eq(orders.paymentAttemptKey, claim.attemptKey),
        ))
        .returning({ id: orders.id });

      if (rows.length) {
        // The paid order now occupies the slot in its own right, so the hold has
        // done its job.
        await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
        await retainInventoryHoldsAfterPaymentWithin(tx, orderId, paidAt);
      }
      return rows;
    });
  } catch (cause) {
    reportError("checkout", "payment completed but local confirmation failed", cause);
    return {
      ok: false,
      code: "PAYMENT_RECONCILING",
      message: "Your payment completed, but the confirmation is still syncing. Please wait a moment and try again; you will not be charged twice.",
      reservationProtected: true,
    };
  }

  if (!updated.length) {
    const [fresh] = await db()
      .select({ status: orders.status, squarePaymentId: orders.squarePaymentId })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (fresh?.status !== "paid" || fresh.squarePaymentId !== payment.paymentId) {
      return {
        ok: false,
        code: "PAYMENT_RECONCILING",
        message: "Your payment completed, but the order status is still syncing. Please contact the store if it does not update shortly.",
        reservationProtected: true,
      };
    }
  }

  // Fired after the response so the customer never waits on Twilio or Resend to
  // see their confirmation. Failures are logged, never surfaced as a failed
  // payment — the money has already moved.
  after(() => notifyOrder(orderId, "order_paid"));

  return {
    ok: true,
    orderNumber: order.orderNumber,
    accessToken: createOrderAccessToken(order.id, order.orderNumber),
  };
}

export interface StalePaymentRecoveryResult {
  examined: number;
  resolved: number;
  unresolved: number;
}

export interface StalePaymentRecoveryOptions {
  limit?: number;
  locationId?: string;
}

/**
 * Reconcile orphaned payment reservations without ever guessing about money.
 *
 * New attempts replay the exact persisted Square request first. If its result
 * remains unknown, or if it predates source-token persistence, Square's
 * cancel-by-idempotency endpoint is the only authority allowed to release the
 * local slot and inventory. An error retains both holds and is surfaced in the
 * maintenance result/log for operations.
 */
export async function recoverStalePaymentAttempts(
  options: StalePaymentRecoveryOptions = {},
): Promise<StalePaymentRecoveryResult> {
  const requestedLimit = options.limit ?? 20;
  const safeLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100))
    : 20;
  const cutoff = new Date(Date.now() - PAYMENT_ATTEMPT_RECOVERY_AFTER_MS);
  const stale = await db()
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      paymentAttemptKey: orders.paymentAttemptKey,
      paymentAttemptSourceId: orders.paymentAttemptSourceId,
      squarePaymentId: orders.squarePaymentId,
    })
    .from(orders)
    .where(and(
      eq(orders.status, "pending_payment"),
      isNotNull(orders.paymentAttemptKey),
      isNotNull(orders.paymentAttemptStartedAt),
      lt(orders.paymentAttemptStartedAt, cutoff),
      options.locationId
        ? eq(orders.squareLocationId, options.locationId)
        : undefined,
    ))
    .limit(safeLimit);

  let resolved = 0;
  let unresolved = 0;

  for (const attempt of stale) {
    const attemptKey = attempt.paymentAttemptKey;
    if (!attemptKey || attempt.squarePaymentId !== paymentAttemptMarker(attempt.id)) {
      reportError("maintenance", "inconsistent payment attempt", undefined, {
        orderNumber: attempt.orderNumber,
      });
      unresolved += 1;
      continue;
    }

    try {
      if (attempt.paymentAttemptSourceId) {
        const replayed = await payForOrder(attempt.id, attempt.paymentAttemptSourceId);
        if (replayed.ok) {
          resolved += 1;
          continue;
        }
        if (!replayed.reservationProtected) {
          // A definitive result restored an already-expired checkout deadline.
          // Mark the orphan canceled so it cannot linger as pending_payment.
          const abandoned = await abandonOrder(attempt.id);
          if (abandoned.outcome === "payment_in_progress") unresolved += 1;
          else resolved += 1;
          continue;
        }
        if (replayed.code === "PAYMENT_IN_PROGRESS") {
          // A customer retry refreshed ownership after the stale scan.
          unresolved += 1;
          continue;
        }
      }

      const cancellation = await cancelSquarePaymentAttempt(attemptKey);
      if (!cancellation.ok) {
        reportError("maintenance", `payment attempt remains unresolved: ${cancellation.code}`, undefined, {
          orderNumber: attempt.orderNumber,
        });
        unresolved += 1;
        continue;
      }

      const released = await cancelLocallyAfterSquareAttempt(
        attempt.id,
        attemptKey,
        attempt.squarePaymentId,
      );
      if (released) {
        resolved += 1;
      } else {
        const [fresh] = await db()
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, attempt.id))
          .limit(1);
        if (fresh?.status && fresh.status !== "pending_payment") resolved += 1;
        else unresolved += 1;
      }
    } catch (cause) {
      reportError("maintenance", "payment recovery failed", cause, {
        orderNumber: attempt.orderNumber,
      });
      unresolved += 1;
    }
  }

  return { examined: stale.length, resolved, unresolved };
}

async function cancelLocallyAfterSquareAttempt(
  orderId: string,
  attemptKey: string,
  paymentMarker: string,
): Promise<boolean> {
  return db().transaction(async (tx) => {
    const now = new Date();
    const canceled = await tx
      .update(orders)
      .set({
        status: "canceled",
        squarePaymentId: null,
        paymentAttemptKey: null,
        paymentAttemptSourceId: null,
        paymentAttemptStartedAt: null,
        canceledAt: now,
        updatedAt: now,
      })
      .where(and(
        eq(orders.id, orderId),
        eq(orders.status, "pending_payment"),
        eq(orders.squarePaymentId, paymentMarker),
        eq(orders.paymentAttemptKey, attemptKey),
      ))
      .returning({ id: orders.id });
    if (!canceled.length) return false;

    await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
    await releaseInventoryHoldsWithin(tx, orderId);
    return true;
  });
}

export type AbandonOrderResult = {
  outcome:
    | "canceled"
    | "payment_in_progress"
    | "already_paid"
    | "already_canceled"
    | "not_found";
};

/** Discard an unpaid order and report exactly why it was or was not released. */
export async function abandonOrder(orderId: string): Promise<AbandonOrderResult> {
  return db().transaction(async (tx) => {
    const canceled = await tx
      .update(orders)
      .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(orders.id, orderId),
        eq(orders.status, "pending_payment"),
        isNull(orders.squarePaymentId),
        isNull(orders.paymentAttemptKey),
        isNull(orders.paymentAttemptSourceId),
      ))
      .returning({ id: orders.id });
    if (canceled.length) {
      await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
      await releaseInventoryHoldsWithin(tx, orderId);
      return { outcome: "canceled" };
    }

    const [current] = await tx
      .select({
        status: orders.status,
        squarePaymentId: orders.squarePaymentId,
        paymentAttemptKey: orders.paymentAttemptKey,
        paymentAttemptSourceId: orders.paymentAttemptSourceId,
      })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!current) return { outcome: "not_found" };
    if (current.status === "canceled") return { outcome: "already_canceled" };
    if (current.status !== "pending_payment") return { outcome: "already_paid" };
    return { outcome: "payment_in_progress" };
  });
}
