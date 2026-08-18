"use server";

import { z } from "zod";

import { resolveCart, toSchedulingCart, normalizeCart } from "@/lib/catalog/cart";
import { getOrderableProducts } from "@/lib/catalog/server";
import {
  createPendingOrder,
  payForOrder,
  type CreateOrderResult,
  type PayResult,
} from "@/lib/orders/create";
import { computeAvailability, type AvailabilityResult } from "@/lib/scheduling/availability";
import { loadAvailabilityInput } from "@/lib/scheduling/queries";

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
  .max(30);

const customerSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name").max(120),
  email: z.email("Please enter a valid email address"),
  phone: z.string().trim().min(7, "Please enter a phone number").max(30),
});

const checkoutSchema = z.object({
  cart: cartSchema,
  pickup: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pickup date"),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "Choose a pickup time"),
  }),
  customer: customerSchema,
  note: z.string().trim().max(500).optional(),
  expectedTotalCents: z.number().int().min(0),
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
): Promise<AvailabilityResult | { ok: false; problem: { kind: "catalog_unavailable" } }> {
  const parsed = cartSchema.safeParse(cart);
  if (!parsed.success) {
    return { ok: false, problem: { kind: "empty_cart" } };
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
  return computeAvailability(await loadAvailabilityInput(schedulingCart));
}

export type StartCheckoutResult =
  | CreateOrderResult
  | { ok: false; failure: { kind: "invalid_input"; fieldErrors: Record<string, string[]> } };

/** Reserve the pickup slot and record the order, unpaid. */
export async function startCheckout(input: unknown): Promise<StartCheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      failure: {
        kind: "invalid_input",
        fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
      },
    };
  }

  return createPendingOrder({
    cart: normalizeCart(parsed.data.cart),
    pickup: parsed.data.pickup,
    customer: parsed.data.customer,
    note: parsed.data.note,
    expectedTotalCents: parsed.data.expectedTotalCents,
  });
}

const paySchema = z.object({
  orderId: z.uuid(),
  sourceId: z.string().min(1),
});

/** Charge the card token produced by the Square Web Payments SDK. */
export async function completeCheckout(input: unknown): Promise<PayResult> {
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: "Payment details were incomplete." };
  }
  return payForOrder(parsed.data.orderId, parsed.data.sourceId);
}
