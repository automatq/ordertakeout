"use server";

import { z } from "zod";

import { requireStaffSession } from "@/lib/auth/guard";
import {
  refundCompletedOrder,
  type StaffRefundResult,
} from "@/lib/orders/refunds";
import { rosterRequiresPin } from "@/lib/staff/roster";

/** Staff refunds on completed orders. The session is re-checked here because
 * server actions are independently addressable endpoints. */

const refundSchema = z.object({
  orderId: z.uuid(),
  amountCents: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(1).max(160),
  staffInitials: z.string().trim().min(2).max(6),
  staffPin: z.string().regex(/^\d{4}$/).optional(),
});

export async function refundOrder(input: unknown): Promise<StaffRefundResult> {
  await requireStaffSession();
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, reason: "Check the amount, reason, and initials, then try again." };
  }
  return refundCompletedOrder(parsed.data);
}

/** Lets the dialog show the PIN field only when this member actually has one. */
export async function refundNeedsPin(initials: string): Promise<boolean> {
  await requireStaffSession();
  if (typeof initials !== "string") return false;
  return rosterRequiresPin(initials);
}
