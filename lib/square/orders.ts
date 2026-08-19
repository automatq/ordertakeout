import "server-only";

import type { Square } from "square";

import type { ResolvedCartLine } from "@/lib/catalog/cart";
import { pickupInstant, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { serverEnv } from "@/lib/env";
import { isDemoMode } from "@/lib/demo/config";

import { squareClient, squareLocationId } from "./client";
import { fromSquareAmount, toSquareAmount } from "./money";

/**
 * Creating the Square order and taking payment.
 *
 * The order is created first as a draft carrying a PICKUP fulfillment, then paid.
 * Square only surfaces an order in Point of Sale and Order Manager once it is
 * paid, which is exactly the behaviour the store asked for: anything they can see
 * on the POS has already been paid for.
 */

export interface SquareOrderInput {
  orderNumber: string;
  lines: readonly ResolvedCartLine[];
  pickup: { date: StoreDate; time: StoreTime };
  customer: { name: string; email: string; phone: string };
  note?: string | null;
}

export interface SquareDraftOrder {
  squareOrderId: string;
  /** Square's computed total — authoritative, see below. */
  totalCents: number;
  subtotalCents: number;
  taxCents: number;
  currency: string;
}

/**
 * Create the draft order in Square.
 *
 * Line items reference catalog object IDs and carry no price, so **Square prices
 * the order, not us**. That's deliberate: the store edits prices in the Square
 * Dashboard, and a price that changed since our catalog cache was written must
 * not result in charging a stale amount. The caller compares Square's computed
 * total against what the customer was shown and aborts on a mismatch rather than
 * quietly charging a different number.
 *
 * `pickup_at` is the one place a store-local date and time becomes a real
 * instant, and Square requires both it and a recipient display name for
 * SCHEDULED pickups.
 */
export async function createSquareDraftOrder(
  input: SquareOrderInput,
): Promise<SquareDraftOrder> {
  const timeZone = serverEnv().STORE_TIMEZONE;

  // Demo mode prices the order from our own resolved lines. In production Square
  // is the pricing authority — see the total comparison in createPendingOrder.
  if (isDemoMode()) {
    const subtotal = input.lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    return {
      squareOrderId: `DEMO_ORDER_${input.orderNumber}`,
      totalCents: subtotal,
      subtotalCents: subtotal,
      taxCents: 0,
      currency: input.lines[0]?.variant.currency ?? "USD",
    };
  }

  const fulfillment: Square.Fulfillment = {
    type: "PICKUP",
    state: "PROPOSED",
    pickupDetails: {
      scheduleType: "SCHEDULED",
      pickupAt: pickupInstant(input.pickup.date, input.pickup.time, timeZone).toISOString(),
      recipient: {
        displayName: input.customer.name,
        emailAddress: input.customer.email,
        phoneNumber: input.customer.phone,
      },
      note: input.note ?? undefined,
    },
  };

  const response = await squareClient().orders.create({
    // Keyed on our order number so a retried request reuses the same Square
    // order rather than creating a duplicate.
    idempotencyKey: `order-${input.orderNumber}`,
    order: {
      locationId: squareLocationId(),
      referenceId: input.orderNumber,
      lineItems: input.lines.map((line) => ({
        catalogObjectId: line.variant.id,
        quantity: String(line.quantity),
      })),
      fulfillments: [fulfillment],
    },
  });

  const order = response.order;
  if (!order?.id) {
    throw new Error("Square did not return an order id");
  }

  return {
    squareOrderId: order.id,
    totalCents: fromSquareAmount(order.totalMoney?.amount),
    subtotalCents: fromSquareAmount(order.netAmountDueMoney?.amount ?? order.totalMoney?.amount),
    taxCents: fromSquareAmount(order.totalTaxMoney?.amount),
    currency: order.totalMoney?.currency ?? "USD",
  };
}

export type PaymentResult =
  | { ok: true; paymentId: string; status: string }
  | { ok: false; code: string; message: string };

/**
 * Charge the customer.
 *
 * `idempotencyKey` is our own order id, which is what makes a double-clicked pay
 * button or a network retry safe: Square returns the original payment instead of
 * charging a second time. It must therefore be stable per order and never
 * regenerated on retry.
 */
export async function createSquarePayment(params: {
  orderId: string;
  squareOrderId: string;
  amountCents: number;
  currency: string;
  sourceId: string;
  buyerEmail: string;
  orderNumber: string;
}): Promise<PaymentResult> {
  if (isDemoMode()) {
    // A card number ending 0002 is the conventional decline test card; honouring
    // it here means the failure path can be demoed too, not just the happy one.
    if (params.sourceId.endsWith("decline")) {
      return { ok: false, code: "CARD_DECLINED", message: "Card declined (demo)." };
    }
    return { ok: true, paymentId: `DEMO_PAY_${params.orderId.slice(0, 8)}`, status: "COMPLETED" };
  }

  try {
    const response = await squareClient().payments.create({
      idempotencyKey: params.orderId,
      sourceId: params.sourceId,
      orderId: params.squareOrderId,
      locationId: squareLocationId(),
      referenceId: params.orderNumber,
      buyerEmailAddress: params.buyerEmail,
      amountMoney: {
        amount: toSquareAmount(params.amountCents),
        currency: params.currency as Square.Currency,
      },
    });

    const payment = response.payment;
    if (!payment?.id) {
      return { ok: false, code: "NO_PAYMENT", message: "Square did not return a payment" };
    }

    return { ok: true, paymentId: payment.id, status: payment.status ?? "UNKNOWN" };
  } catch (cause) {
    // Square's card errors (declined, CVV, expired) arrive as thrown errors with
    // a structured body. Surface the code so checkout can show something better
    // than "something went wrong".
    const detail = extractSquareError(cause);
    console.error("[payments] create failed:", detail);
    return { ok: false, ...detail };
  }
}

/** Refund a payment in full — used by cancellation. */
export async function refundSquarePayment(params: {
  paymentId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<{ ok: true; refundId: string } | { ok: false; code: string; message: string }> {
  try {
    const response = await squareClient().refunds.refundPayment({
      idempotencyKey: params.idempotencyKey,
      paymentId: params.paymentId,
      reason: params.reason,
      amountMoney: {
        amount: toSquareAmount(params.amountCents),
        currency: params.currency as Square.Currency,
      },
    });

    const refund = response.refund;
    if (!refund?.id) {
      return { ok: false, code: "NO_REFUND", message: "Square did not return a refund" };
    }
    return { ok: true, refundId: refund.id };
  } catch (cause) {
    const detail = extractSquareError(cause);
    console.error("[refunds] refund failed:", detail);
    return { ok: false, ...detail };
  }
}

function extractSquareError(cause: unknown): { code: string; message: string } {
  if (cause && typeof cause === "object" && "body" in cause) {
    const body = (cause as { body?: { errors?: { code?: string; detail?: string }[] } }).body;
    const first = body?.errors?.[0];
    if (first) {
      return {
        code: first.code ?? "SQUARE_ERROR",
        message: first.detail ?? "Payment could not be processed.",
      };
    }
  }
  return {
    code: "SQUARE_ERROR",
    message: cause instanceof Error ? cause.message : "Payment could not be processed.",
  };
}
