import { loyaltyBalance, loyaltyLedger, REWARD_DISCOUNT_CENTS, REWARD_POINTS } from "@/lib/accounts/loyalty";
import { customerAccountFromRequest } from "@/lib/api/context";
import { ok, unauthorized } from "@/lib/api/envelope";

/**
 * A customer's own rewards balance and recent points activity.
 *
 * Needs a session for the same reason the order history does: a balance is a
 * fact about a named person's spending, not something an order key should open.
 *
 * The thresholds ride along in the response rather than being compiled into the
 * app. A shipped build lives on a phone for months, and "100 points unlocks $10
 * off" is a business decision the shop may change long before the customer
 * updates — an app that hardcodes it would draw a confidently wrong progress bar.
 */
export async function GET(request: Request): Promise<Response> {
  const accountId = await customerAccountFromRequest(request);
  if (!accountId) return unauthorized();

  const [points, ledger] = await Promise.all([
    loyaltyBalance(accountId),
    loyaltyLedger(accountId),
  ]);

  return ok({
    points,
    rewardPoints: REWARD_POINTS,
    rewardDiscountCents: REWARD_DISCOUNT_CENTS,
    /* `kind` on the wire, not a sentence: the app words these its own way, the
       same way it already carries its own order-status labels. */
    entries: ledger.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      points: entry.points,
      orderNumber: entry.orderNumber,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
}
