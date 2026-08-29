import "server-only";

import type { Square } from "square";

import type { ResolvedCartLine } from "@/lib/catalog/cart";
import { pickupInstant, type StoreDate, type StoreTime } from "@/lib/scheduling/time";
import { serverEnv } from "@/lib/env";
import { isDemoMode } from "@/lib/demo/config";
import { reportError } from "@/lib/monitoring/report";
import {
  classifyRefundStatus,
  type RefundDisposition,
} from "@/lib/webhooks/events";

import { squareClient } from "./client";
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
  locationId: string;
  orderNumber: string;
  lines: readonly ResolvedCartLine[];
  pickup: { date: StoreDate; time: StoreTime };
  customer: { name: string; email: string; phone: string };
  note?: string | null;
  timeZone?: string;
  /** Optional account reward applied as an order-level fixed discount. */
  rewardDiscountCents?: number;
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
  const timeZone = input.timeZone ?? serverEnv().STORE_TIMEZONE;

  // Demo mode prices the order from our own resolved lines. In production Square
  // is the pricing authority — see the total comparison in createPendingOrder.
  if (isDemoMode()) {
    const subtotal = Math.max(0, input.lines.reduce((sum, line) => sum + line.lineTotalCents, 0) - (input.rewardDiscountCents ?? 0));
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
      locationId: input.locationId,
      referenceId: input.orderNumber,
      lineItems: input.lines.map((line) => ({
        catalogObjectId: line.variant.id,
        quantity: String(line.quantity),
      })),
      ...(input.rewardDiscountCents ? {
        discounts: [{
          name: "Rewards reward",
          type: "FIXED_AMOUNT" as const,
          amountMoney: { amount: toSquareAmount(input.rewardDiscountCents), currency: input.lines[0]?.variant.currency as Square.Currency },
          scope: "ORDER" as const,
        }],
      } : {}),
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
    subtotalCents:
      fromSquareAmount(order.totalMoney?.amount) - fromSquareAmount(order.totalTaxMoney?.amount),
    taxCents: fromSquareAmount(order.totalTaxMoney?.amount),
    currency: order.totalMoney?.currency ?? "USD",
  };
}

export type PaymentResult =
  | { ok: true; paymentId: string; status: "COMPLETED" }
  | { ok: false; code: string; message: string };

/** Keep the external call well inside the two-minute local ownership lease. */
export const PAYMENT_REQUEST_TIMEOUT_SECONDS = 30;

/**
 * Charge the customer.
 *
 * The caller persists one `idempotencyKey` per logical payment attempt. It is
 * reused after an ambiguous response, but rotated after a definitive failure so
 * corrected card details are not pinned to the old declined request.
 */
export async function createSquarePayment(params: {
  idempotencyKey: string;
  locationId: string;
  orderId: string;
  squareOrderId: string;
  amountCents: number;
  /** Charged in addition to amountMoney; the Square order total stays untipped. */
  tipCents?: number;
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
    const response = await squareClient().payments.create(
      {
        idempotencyKey: params.idempotencyKey,
        sourceId: params.sourceId,
        orderId: params.squareOrderId,
        locationId: params.locationId,
        referenceId: params.orderNumber,
        buyerEmailAddress: params.buyerEmail,
        amountMoney: {
          amount: toSquareAmount(params.amountCents),
          currency: params.currency as Square.Currency,
        },
        ...(params.tipCents && params.tipCents > 0
          ? {
              tipMoney: {
                amount: toSquareAmount(params.tipCents),
                currency: params.currency as Square.Currency,
              },
            }
          : {}),
      },
      {
        timeoutInSeconds: PAYMENT_REQUEST_TIMEOUT_SECONDS,
        // App-level retries reuse the persisted source and key. SDK retries can
        // otherwise keep one invocation alive beyond the ownership lease.
        maxRetries: 0,
      },
    );

    const payment = response.payment;
    if (!payment?.id) {
      return { ok: false, code: "NO_PAYMENT", message: "Square did not return a payment" };
    }

    // An APPROVED payment is only authorised, not captured. PENDING can still
    // fail later. The payment webhook will reconcile the local order if either
    // state subsequently reaches COMPLETED.
    if (payment.status !== "COMPLETED") {
      const status = payment.status ?? "UNKNOWN";
      return {
        ok: false,
        code: `PAYMENT_${status}`,
        message:
          status === "APPROVED" || status === "PENDING"
            ? "Your payment is still processing. Please wait a moment and try again; you will not be charged twice."
            : "Square did not complete the payment. Please try again or use another card.",
      };
    }

    return { ok: true, paymentId: payment.id, status: "COMPLETED" };
  } catch (cause) {
    // Square's card errors (declined, CVV, expired) arrive as thrown errors with
    // a structured body. Surface the code so checkout can show something better
    // than "something went wrong".
    const detail = extractSquareError(cause);
    reportError("payments", "create failed", cause, { ...detail });
    return { ok: false, ...detail };
  }
}

export type CancelPaymentAttemptResult =
  | { ok: true }
  | { ok: false; code: string; message: string; ambiguous: true };

/**
 * Resolve a stale/unknown CreatePayment before freeing local reservations.
 * Square treats both "canceled" and "no payment found for this key" as success.
 * Any error leaves the remote state unknown and must keep the local holds.
 */
export async function cancelSquarePaymentAttempt(
  idempotencyKey: string,
): Promise<CancelPaymentAttemptResult> {
  if (isDemoMode()) return { ok: true };

  try {
    await squareClient().payments.cancelByIdempotencyKey(
      { idempotencyKey },
      { timeoutInSeconds: PAYMENT_REQUEST_TIMEOUT_SECONDS, maxRetries: 0 },
    );
    return { ok: true };
  } catch (cause) {
    const detail = extractSquareError(cause);
    reportError("payments", "cancel-by-idempotency-key failed", cause, { ...detail });
    return { ok: false, ...detail, ambiguous: true };
  }
}

/** Refund a payment in full — used by cancellation. */
export type RefundResult =
  | {
      ok: true;
      refundId: string;
      status: string | null;
      disposition: RefundDisposition;
    }
  | {
      ok: false;
      code: string;
      message: string;
      certainty: "definitive" | "ambiguous";
    };

export async function refundSquarePayment(params: {
  paymentId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  reason?: string;
}): Promise<RefundResult> {
  if (isDemoMode()) {
    return {
      ok: true,
      refundId: `DEMO_REFUND_${params.idempotencyKey}`,
      status: "COMPLETED",
      disposition: "completed",
    };
  }
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
      return {
        ok: false,
        code: "NO_REFUND",
        message: "Square did not return a refund",
        // A malformed 2xx response does not prove that Square failed to create
        // the refund. Preserve the attempt key and reconcile before retrying.
        certainty: "ambiguous",
      };
    }
    const status = refund.status ?? null;
    return {
      ok: true,
      refundId: refund.id,
      status,
      disposition: classifyRefundStatus(status),
    };
  } catch (cause) {
    const detail = extractSquareError(cause);
    reportError("refunds", "refund failed", cause, { ...detail });
    return {
      ok: false,
      ...detail,
      certainty: isDefinitiveSquareRejection(cause) ? "definitive" : "ambiguous",
    };
  }
}

/** A 4xx Square response proves the request was rejected before refund success. */
function isDefinitiveSquareRejection(cause: unknown): boolean {
  if (!cause || typeof cause !== "object" || !("statusCode" in cause)) return false;
  const statusCode = (cause as { statusCode?: unknown }).statusCode;
  return typeof statusCode === "number" &&
    statusCode >= 400 &&
    statusCode < 500 &&
    // These responses can be emitted by an intermediary while the upstream
    // request is still in flight. Reusing the attempt key is safer than risking
    // a second refund.
    statusCode !== 408 &&
    statusCode !== 425 &&
    statusCode !== 429;
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
