"use server";

import { z } from "zod";

import { resolveCart, toSchedulingCart, normalizeCart } from "@/lib/catalog/cart";
import { getOrderableProducts } from "@/lib/catalog/server";
import {
  abandonOrder,
  createPendingOrder,
  payForOrder,
  type AbandonOrderResult,
  type CreateOrderFailure,
  type CreateOrderResult,
  type PayResult,
} from "@/lib/orders/create";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { computeAvailability, type AvailabilityResult } from "@/lib/scheduling/availability";
import { loadAvailabilityInput } from "@/lib/scheduling/queries";
import { AVAILABILITY_PREVIEW_DAYS } from "@/lib/store";
import { getStoreLocation } from "@/lib/locations/server";
import { normalizePhoneE164 } from "@/lib/phone";
import { getPauseStateFresh } from "@/lib/settings/pause";
import { inventoryShortages } from "@/lib/inventory/map";
import { getInventoryQuantities } from "@/lib/inventory/server";
import { consumeRateLimit, requestFingerprint } from "@/lib/security/rate-limit";
import { getCurrentCustomerAccount } from "@/lib/accounts/loyalty";

/**
 * Checkout server actions.
 *
 * Every input is re-validated here. The browser is not trusted for prices,
 * pickup validity, or totals — the cart is re-priced from the catalog and the
 * pickup selection is re-checked against the scheduling rules immediately before
 * the card is charged.
 */

const cartSchema = z
  .array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().min(1).max(50),
    }),
  )
  .max(30)
  .superRefine((items, context) => {
    const totals = new Map<string, number>();
    for (const item of items) {
      const quantity = (totals.get(item.variantId) ?? 0) + item.quantity;
      totals.set(item.variantId, quantity);
      if (quantity > 50) {
        context.addIssue({
          code: "custom",
          message: "A cart line cannot exceed 50 of one item",
        });
        return;
      }
    }
  });

const customerSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email address"),
  // Normalized to E.164 so the number we store is one Twilio can text.
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((value, context) => {
      const parsed = normalizePhoneE164(value);
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.message });
        return z.NEVER;
      }
      return parsed.e164;
    }),
});

const checkoutSchema = z.object({
  locationId: z.string().min(1, "Choose a pickup location"),
  cart: cartSchema,
  pickup: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pickup date"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Choose a pickup time"),
  }),
  customer: customerSchema,
  note: z.string().trim().max(500).optional(),
  expectedTotalCents: z.number().int().min(0),
  redeemReward: z.boolean().optional(),
  /** Consent to transactional texts ("your order is ready"). Default off. */
  smsOptIn: z.boolean().optional(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * Pickup dates and times available for the current cart.
 *
 * Backs the picker UI. It is advisory only — the same rules are re-run
 * server-side inside the reservation lock before anything is charged.
 */
export async function getCartAvailability(
  cart: unknown,
  locationId?: unknown,
): Promise<
  | AvailabilityResult
  | { ok: false; problem: { kind: "catalog_unavailable" } }
  | { ok: false; problem: { kind: "ordering_paused"; note: string | null } }
> {
  const parsed = cartSchema.safeParse(cart);
  if (!parsed.success) {
    return { ok: false, problem: { kind: "empty_cart" } };
  }
  if (typeof locationId !== "string" || !locationId || !(await getStoreLocation(locationId))) {
    return { ok: false, problem: { kind: "catalog_unavailable" } };
  }
  const paused = await getPauseStateFresh(locationId);
  if (paused) {
    return { ok: false, problem: { kind: "ordering_paused", note: paused.note } };
  }
  const limit = await consumeRateLimit(
    "checkout-availability",
    await requestFingerprint(),
    { attempts: 30, windowMs: 60_000 },
  );
  if (!limit.allowed) {
    return { ok: false, problem: { kind: "catalog_unavailable" } };
  }

  const catalog = await getOrderableProducts();
  if (catalog.error) {
    return { ok: false, problem: { kind: "catalog_unavailable" } };
  }

  const resolved = resolveCart(normalizeCart(parsed.data), catalog.products);
  if (!resolved.ok) {
    return {
      ok: false,
      problem: { kind: "unknown_product", productId: resolved.unknownVariantIds[0] ?? "" },
    };
  }

  const schedulingCart = toSchedulingCart(resolved.lines);
  const inventory = await getInventoryQuantities(
    locationId,
    resolved.lines.map((line) => line.variant.id),
  );
  if (inventoryShortages(
    resolved.lines.map((line) => ({ variationId: line.variant.id, quantity: line.quantity })),
    inventory,
  ).length) {
    return { ok: false, problem: { kind: "catalog_unavailable" } };
  }
  /* Preview window, not the full bookable horizon — see AVAILABILITY_PREVIEW_DAYS.
     This is refetched on every cart change, so its size is felt on the critical
     path to payment, on whatever connection the customer happens to have. */
  return computeAvailability(
    await loadAvailabilityInput(schedulingCart, undefined, locationId, AVAILABILITY_PREVIEW_DAYS),
  );
}

type PublicCreateOrderFailure =
  | Exclude<CreateOrderFailure, { kind: "insufficient_stock" }>
  | { kind: "insufficient_stock" };

export type StartCheckoutResult =
  | { ok: false; failure: { kind: "ordering_paused"; note: string | null } }
  | (Extract<CreateOrderResult, { ok: true }> & { locationId: string })
  | { ok: false; failure: PublicCreateOrderFailure }
  | { ok: false; failure: { kind: "invalid_input"; fieldErrors: Record<string, string[]> } }
  | { ok: false; failure: { kind: "rate_limited" } };

/**
 * Group validation issues by their full dotted path.
 *
 * `z.flattenError` keys only by the FIRST path segment, so every problem inside
 * `customer` came back under a single `customer` key. The UI was looking for
 * `customer.name`, so per-field messages silently never rendered and the
 * customer saw a form that rejected them without saying which field was wrong.
 */
function fieldErrorsByPath(error: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join(".") || "form";
    (errors[path] ??= []).push(issue.message);
  }

  return errors;
}

/** Reserve the pickup slot and record the order, unpaid. */
export async function startCheckout(input: unknown): Promise<StartCheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      failure: { kind: "invalid_input", fieldErrors: fieldErrorsByPath(parsed.error) },
    };
  }

  const limit = await consumeRateLimit(
    "checkout-start",
    await requestFingerprint(),
    { attempts: 6, windowMs: 10 * 60_000 },
  );
  if (!limit.allowed) {
    return { ok: false, failure: { kind: "rate_limited" } };
  }

  const paused = await getPauseStateFresh(parsed.data.locationId);
  if (paused) {
    return { ok: false, failure: { kind: "ordering_paused", note: paused.note } };
  }

  const result = await createPendingOrder({
    locationId: parsed.data.locationId,
    cart: normalizeCart(parsed.data.cart),
    pickup: parsed.data.pickup,
    customer: parsed.data.customer,
    note: parsed.data.note,
    smsOptIn: parsed.data.smsOptIn === true,
    expectedTotalCents: parsed.data.expectedTotalCents,
    // Never accept an account id from the browser. A reward may be attached
    // only to this device's signed-in account and its matching checkout email.
    ...(await accountForCheckout(parsed.data.customer.email, parsed.data.redeemReward)),
  });
  if (result.ok) return { ...result, locationId: parsed.data.locationId };
  return result.failure.kind === "insufficient_stock"
    ? { ok: false, failure: { kind: "insufficient_stock" } }
    : result;
}

async function accountForCheckout(email: string, redeemReward?: boolean) {
  // Preserve the entirely cookie-free guest checkout path. Besides reducing
  // work on the hot path, this keeps the action usable in isolated tests.
  if (!redeemReward) return {};
  const account = await getCurrentCustomerAccount();
  if (!account || account.email !== email.trim().toLowerCase()) return {};
  return { accountId: account.id, redeemReward: Boolean(redeemReward) };
}

const paySchema = z.object({
  orderId: z.uuid(),
  // Square token payloads are short opaque strings. Bound this before it can
  // become a persisted payment-attempt source on a rate-limited endpoint.
  sourceId: z.string().min(1).max(512),
  /** Gratuity in cents; payForOrder re-caps it against the order total. */
  tipCents: z.number().int().min(0).max(50_000).optional(),
});

/** Charge the card token produced by the Square Web Payments SDK. */
export async function completeCheckout(input: unknown): Promise<PayResult> {
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Payment details were incomplete." };
  }
  const limit = await consumeRateLimit(
    "checkout-pay",
    await requestFingerprint(),
    { attempts: 10, windowMs: 10 * 60_000 },
  );
  if (!limit.allowed) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many payment attempts. Wait a few minutes before trying again.",
    };
  }
  return payForOrder(parsed.data.orderId, parsed.data.sourceId, parsed.data.tipCents ?? 0);
}

const abandonSchema = z.object({
  orderId: z.uuid(),
  orderNumber: z.string().min(1).max(64),
  reservationToken: z.string().min(1).max(128),
});

/**
 * Release an unpaid reservation when its owner intentionally returns to edit.
 * The signed token is issued with the reservation; a bare order id is never
 * enough to cancel another customer's hold.
 */
export type AbandonCheckoutResult =
  | ({ ok: true } & AbandonOrderResult)
  | { ok: false };

export async function abandonCheckout(input: unknown): Promise<AbandonCheckoutResult> {
  const parsed = abandonSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  // Authenticate before creating any rate-limit row keyed by this request. A
  // forged order id must not become an unbounded database-allocation primitive.
  if (!verifyOrderAccessToken(
    parsed.data.orderId,
    parsed.data.orderNumber,
    parsed.data.reservationToken,
  )) {
    return { ok: false };
  }
  const limit = await consumeRateLimit(
    "checkout-abandon",
    await requestFingerprint(),
    { attempts: 10, windowMs: 10 * 60_000 },
  );
  if (!limit.allowed) return { ok: false };

  return { ok: true, ...(await abandonOrder(parsed.data.orderId)) };
}
