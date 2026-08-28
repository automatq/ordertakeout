import "server-only";

import { z } from "zod";

import { verifyOrderAccessToken } from "@/lib/orders/access";
import { customerCancellationEligibility } from "@/lib/orders/cancellation";
import { getOrderByNumber } from "@/lib/orders/lookup";
import { advanceOrder } from "@/lib/orders/transitions";
import { consumeRateLimit } from "@/lib/security/rate-limit";

/**
 * `code` exists for the route, which has to turn a refusal into a status: a
 * client that cannot tell "slow down" from "this link is wrong" will retry the
 * one case it should back off from. The web action drops it, because its
 * callers render `reason` and nothing else.
 */
export type CancelOrderResult =
  | { ok: true }
  | { ok: false; code: "rate_limited" | "invalid_request"; reason: string };

const cancelSchema = z.object({ orderNumber: z.string().min(1), accessToken: z.string().min(20) });

/**
 * Cancelling an order on the customer's own authority.
 *
 * Shared by the web action and the app's route so the two cannot drift on the
 * three rules that matter: the rate limit, the signed-token check, and the
 * production cutoff. A phone that could cancel past the cutoff would cancel
 * trays already in the oven.
 *
 * The fingerprint is a parameter because deriving it is the one Next-specific
 * step — an action reads `headers()`, a route reads the request it was handed —
 * and threading it in keeps everything below this line free of both.
 */
export async function cancelOrderWithToken(
  input: unknown,
  fingerprint: string,
): Promise<CancelOrderResult> {
  const limit = await consumeRateLimit("customer-cancel", fingerprint, {
    attempts: 5,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return {
      ok: false,
      code: "rate_limited",
      reason: "Too many attempts. Wait a few minutes and try again.",
    };
  }

  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, code: "invalid_request", reason: "That cancellation link is invalid." };
  }

  const order = await getOrderByNumber(parsed.data.orderNumber);
  if (!order || !verifyOrderAccessToken(order.id, order.orderNumber, parsed.data.accessToken)) {
    return { ok: false, code: "invalid_request", reason: "That cancellation link is invalid." };
  }

  const eligibility = await customerCancellationEligibility(order);
  if (!eligibility.allowed) {
    return { ok: false, code: "invalid_request", reason: eligibility.reason };
  }

  const result = await advanceOrder(order.id, "canceled", { type: "customer" });
  if (result.ok && result.status === "canceled") return { ok: true };
  return {
    ok: false,
    code: "invalid_request",
    reason: result.ok
      ? result.notice ?? "Your refund is still processing. The order remains active until Square confirms it."
      : result.reason,
  };
}
