import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  orderItems,
  orders,
  pickupVerifications,
  loyaltyEntries,
  type OrderStatus,
} from "@/lib/db/schema";

import { mirrorToSquare } from "./transitions";
import { isOrderNumber, normalizeOrderNumber } from "./number";
import { parsePickupPass, verifyPickupPass } from "./pickup-pass";
import { REWARD_POINTS } from "@/lib/accounts/loyalty";
import { recordAuditWithin } from "@/lib/audit/log";
import { normalizeInitials, validateInitials } from "@/lib/staff/roster";

export type PickupVerificationMethod = "qr" | "manual";

export type PickupVerificationPreview = {
  orderId: string;
  orderNumber: string;
  customerName: string;
  pickupDate: string;
  pickupTime: string;
  pickupLocationName: string | null;
  itemCount: number;
  method: PickupVerificationMethod;
};

export type PickupVerificationResult =
  | { ok: true; orderId: string; orderNumber: string; squareWarning?: string }
  | { ok: false; reason: string };

type VerificationInput = { method: PickupVerificationMethod; value: string };

function failureForStatus(status: OrderStatus): string {
  if (status === "completed") return "This order has already been verified as picked up.";
  if (status === "canceled") return "This order was cancelled and cannot be collected.";
  return "This order is not ready for pickup yet.";
}


async function resolveOrder(input: VerificationInput): Promise<{
  order: typeof orders.$inferSelect;
  method: PickupVerificationMethod;
} | { reason: string }> {
  let orderNumber: string;
  let token: string | null = null;

  if (input.method === "qr") {
    const parsed = parsePickupPass(input.value);
    if (!parsed) return { reason: "That pickup pass could not be verified." };
    orderNumber = parsed.orderNumber;
    token = parsed.token;
  } else {
    orderNumber = normalizeOrderNumber(input.value);
    if (!isOrderNumber(orderNumber)) return { reason: "Enter a valid order number." };
  }

  const [order] = await db()
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!order) return { reason: "No matching order was found." };

  if (token && !verifyPickupPass(order.id, order.orderNumber, token)) {
    return { reason: "That pickup pass could not be verified." };
  }

  return { order, method: input.method };
}

export async function previewPickupVerification(
  input: VerificationInput,
): Promise<PickupVerificationPreview | { ok: false; reason: string }> {
  const resolved = await resolveOrder(input);
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  if (resolved.order.status !== "ready") {
    return { ok: false, reason: failureForStatus(resolved.order.status) };
  }

  const items = await db()
    .select({ quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, resolved.order.id));

  return {
    orderId: resolved.order.id,
    orderNumber: resolved.order.orderNumber,
    customerName: resolved.order.customerName,
    pickupDate: resolved.order.pickupDate,
    pickupTime: resolved.order.pickupTime,
    pickupLocationName: resolved.order.pickupLocationName,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    method: resolved.method,
  };
}

/**
 * Atomically record the counter evidence and complete a ready order.
 *
 * The verification payload is resolved again here; a preview is advisory and
 * must never become an authority to complete a different order later.
 */
export async function verifyPickup(
  input: VerificationInput & { staffInitials: string },
): Promise<PickupVerificationResult> {
  const initials = normalizeInitials(input.staffInitials);
  if (!initials) return { ok: false, reason: "Enter 2–6 staff initials." };
  const roster = await validateInitials(initials);
  if (!roster.ok) return { ok: false, reason: roster.message };

  const resolved = await resolveOrder(input);
  if ("reason" in resolved) return { ok: false, reason: resolved.reason };
  if (resolved.order.status !== "ready") {
    return { ok: false, reason: failureForStatus(resolved.order.status) };
  }

  const now = new Date();
  const completed = await db().transaction(async (tx) => {
    const updated = await tx
      .update(orders)
      .set({ status: "completed", completedAt: now, updatedAt: now })
      .where(and(eq(orders.id, resolved.order.id), eq(orders.status, "ready")))
      .returning({ id: orders.id });
    if (!updated.length) return false;

    await tx.insert(pickupVerifications).values({
      orderId: resolved.order.id,
      method: resolved.method,
      staffInitials: initials,
      verifiedAt: now,
    });
    // Points are issued at the same moment as the verified completion, never
    // at payment or when an order merely becomes ready.
    if (resolved.order.customerAccountId) {
      const points = Math.floor(resolved.order.totalCents / 100);
      if (points > 0) {
        await tx.insert(loyaltyEntries).values({
          customerAccountId: resolved.order.customerAccountId,
          orderId: resolved.order.id,
          kind: "earned",
          points,
        }).onConflictDoNothing();
      }
    }
    await recordAuditWithin(tx, {
      actorType: "staff",
      actorInitials: initials,
      action: "order.pickup_verified",
      entityType: "order",
      orderId: resolved.order.id,
      metadata: { method: resolved.method, orderNumber: resolved.order.orderNumber },
    });
    return true;
  });

  if (!completed) {
    return { ok: false, reason: "This order was updated by another staff member. Scan it again to refresh." };
  }

  const squareWarning = resolved.order.squareOrderId
    ? await mirrorToSquare(resolved.order.squareOrderId, "completed")
    : undefined;
  await db()
    .update(orders)
    .set({ squareSyncError: squareWarning ?? null, updatedAt: new Date() })
    .where(eq(orders.id, resolved.order.id));

  return {
    ok: true,
    orderId: resolved.order.id,
    orderNumber: resolved.order.orderNumber,
    squareWarning,
  };
}
