import type { CustomerOrder } from "@/lib/api/dto";
import { ok } from "@/lib/api/envelope";
import { verifyOrderAccessToken } from "@/lib/orders/access";
import { customerCancellationEligibility } from "@/lib/orders/cancellation";
import { getOrderByNumber } from "@/lib/orders/lookup";
import { createPickupPass } from "@/lib/orders/pickup-pass";
import { serverEnv } from "@/lib/env";
import { normalizeTime, storeToday } from "@/lib/scheduling/time";

/**
 * One order, for the person who placed it.
 *
 * Authorised by the signed key that was mailed to them, exactly as the web page
 * is — there is no account required to see your own order, and adding one here
 * would lock people out of the order they already paid for.
 *
 * Every failure looks identical: same status, same body, whether the order does
 * not exist, the key is wrong, or the key is missing. Anything else turns this
 * endpoint into an oracle for which order numbers are real — and order numbers
 * are short, printed on receipts, and guessable enough to be worth protecting.
 */

/**
 * Deliberately 200 rather than 404.
 *
 * A 404 for a bad key and a 404 for a missing order are indistinguishable in the
 * body but not in a proxy log or a client's error handling, and the status line
 * is the easiest thing in the world to measure. One shape for both.
 */
const notFound = () => ok({ found: false as const });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderNumber: string }> },
): Promise<Response> {
  const { orderNumber } = await params;
  const key = new URL(request.url).searchParams.get("key") ?? undefined;

  const order = await getOrderByNumber(orderNumber);
  if (!order) return notFound();
  if (!verifyOrderAccessToken(order.id, order.orderNumber, key)) return notFound();

  const canceled = order.status === "canceled";
  const paid = order.status !== "pending_payment" && !canceled;
  /* Same rule as the web page: a pass is only meaningful while there is still
     something to collect. */
  const collectable = paid && order.status !== "completed";

  /* Costs a couple of reads on a screen the app polls, and is worth it: the
     alternative is offering Cancel and finding out it was refused. */
  const eligibility = await customerCancellationEligibility(order);

  const data: CustomerOrder = {
    orderNumber: order.orderNumber,
    status: order.status,
    customerName: order.customerName,
    pickupDate: order.pickupDate,
    pickupTime: normalizeTime(order.pickupTime),
    pickup: {
      name: order.pickupLocationName,
      address: order.pickupLocationAddress,
      city: order.pickupLocationCity,
      phone: order.pickupLocationPhone,
    },
    items: order.items.map((item) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
    })),
    subtotalCents: order.subtotalCents,
    taxCents: order.taxCents,
    tipCents: order.tipCents ?? 0,
    totalCents: order.totalCents,
    currency: order.currency,
    customerNote: order.customerNote,
    pickupPass: collectable ? createPickupPass(order.id, order.orderNumber) : null,
    cancellation: {
      allowed: eligibility.allowed,
      reason: eligibility.allowed ? null : eligibility.reason,
    },
  };

  /* The shop's today, so "Today at 4pm" means today where the cake is. */
  return ok({
    found: true as const,
    today: storeToday(new Date(), serverEnv().STORE_TIMEZONE),
    order: data,
  });
}
