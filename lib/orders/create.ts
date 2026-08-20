import "server-only";

import { after } from "next/server";

import { and, eq, gt } from "drizzle-orm";

import { resolveCart, toSchedulingCart, type CartItem } from "@/lib/catalog/cart";
import { getOrderableProducts } from "@/lib/catalog/server";
import { db } from "@/lib/db";
import { orderItems, orders, slotHolds } from "@/lib/db/schema";
import { reserveSlotWithin } from "@/lib/scheduling/queries";
import type { SelectionRejection } from "@/lib/scheduling/availability";
import { normalizeTime, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { notifyOrder } from "@/lib/notifications/dispatch";
import { getStoreLocation } from "@/lib/locations/server";
import { inventoryShortages } from "@/lib/inventory/map";
import { getFreshInventoryQuantities } from "@/lib/inventory/server";
import { createSquareDraftOrder, createSquarePayment } from "@/lib/square/orders";

import { generateOrderNumber } from "./number";
import { createOrderAccessToken } from "./access";

const ORDER_NUMBER_UNIQUE_CONSTRAINT = "orders_order_number_key";
const MAX_ORDER_NUMBER_INSERT_ATTEMPTS = 3;

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
    };

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
  const inventory = await getFreshInventoryQuantities(
    location.id,
    resolved.lines.map((line) => line.variant.id),
  );
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
  let orderNumber: string | undefined;
  let created: { orderId: string; expiresAt: Date } | undefined;

  // Order, line items and slot hold commit together. A hold pointing at an order
  // that failed to insert would block a pickup slot for nothing. The database
  // unique index is the final collision guarantee; retry only that conflict.
  for (let attempt = 0; attempt < MAX_ORDER_NUMBER_INSERT_ATTEMPTS; attempt += 1) {
    const candidateOrderNumber = generateOrderNumber();

    try {
      created = await db().transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            orderNumber: candidateOrderNumber,
            customerName: input.customer.name,
            customerEmail: input.customer.email,
            customerPhone: input.customer.phone,
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

        return { orderId: order.id, expiresAt: claim.expiresAt };
      });
      orderNumber = candidateOrderNumber;
      break;
    } catch (cause) {
      if (cause instanceof SlotRejectedError) {
        return { ok: false, failure: { kind: "slot_rejected", rejection: cause.rejection } };
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
  const draft = await createSquareDraftOrder({
    locationId: location.id,
    orderNumber,
    lines: resolved.lines,
    pickup,
    customer: input.customer,
    note: input.note ?? null,
    timeZone: location.timezone ?? undefined,
  });

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

  await db()
    .update(orders)
    .set({
      squareOrderId: draft.squareOrderId,
      subtotalCents: draft.subtotalCents,
      taxCents: draft.taxCents,
      totalCents: draft.totalCents,
      currency: draft.currency,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, created.orderId));

  return {
    ok: true,
    orderId: created.orderId,
    orderNumber,
    subtotalCents: draft.subtotalCents,
    taxCents: draft.taxCents,
    totalCents: draft.totalCents,
    currency: draft.currency,
    holdExpiresAt: created.expiresAt,
  };
}

class SlotRejectedError extends Error {
  constructor(readonly rejection: SelectionRejection) {
    super("Pickup slot rejected");
    this.name = "SlotRejectedError";
  }
}

export type PayResult =
  | { ok: true; orderNumber: string; accessToken: string }
  | { ok: false; code: string; message: string };

/**
 * Charge a pending order and mark it paid.
 *
 * The window between "Square took the money" and "our database says paid" is the
 * one genuinely dangerous moment in checkout. Three things narrow it:
 *
 *   - The payment is idempotent on our order id, so retrying is safe and cannot
 *     double-charge.
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

  // The reservation may have lapsed while the customer typed their card details.
  const [hold] = await db()
    .select({ id: slotHolds.id, expiresAt: slotHolds.expiresAt })
    .from(slotHolds)
    .where(and(eq(slotHolds.orderId, orderId), gt(slotHolds.expiresAt, new Date())))
    .limit(1);

  if (!hold) {
    return {
      ok: false,
      code: "HOLD_EXPIRED",
      message: "Your pickup time was released because checkout took too long. Please choose a time again.",
    };
  }

  if (!order.squareLocationId || !(await getStoreLocation(order.squareLocationId))) {
    return { ok: false, code: "LOCATION_UNAVAILABLE", message: "This pickup location is no longer available." };
  }

  // Inventory can change while the card form is open or through the POS. Read
  // it again immediately before charging so a stale browsing result never
  // becomes a paid oversell.
  const items = await db()
    .select({ variationId: orderItems.squareCatalogObjectId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  const inventory = await getFreshInventoryQuantities(
    order.squareLocationId,
    items.map((item) => item.variationId),
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

  const payment = await createSquarePayment({
    locationId: order.squareLocationId ?? "",
    orderId,
    squareOrderId: order.squareOrderId,
    amountCents: order.totalCents,
    currency: order.currency,
    sourceId,
    buyerEmail: order.customerEmail,
    orderNumber: order.orderNumber,
  });

  if (!payment.ok) {
    return { ok: false, code: payment.code, message: payment.message };
  }

  const paidAt = new Date();
  await db().transaction(async (tx) => {
    await tx
      .update(orders)
      .set({
        status: "paid",
        squarePaymentId: payment.paymentId,
        paidAt,
        updatedAt: paidAt,
      })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")));

    // The paid order now occupies the slot in its own right, so the hold has
    // done its job.
    await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
  });

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

/** Discard an unpaid order and free its slot. */
export async function abandonOrder(orderId: string): Promise<void> {
  await db().transaction(async (tx) => {
    await tx.delete(slotHolds).where(eq(slotHolds.orderId, orderId));
    await tx
      .update(orders)
      .set({ status: "canceled", canceledAt: new Date() })
      .where(and(eq(orders.id, orderId), eq(orders.status, "pending_payment")));
  });
}
