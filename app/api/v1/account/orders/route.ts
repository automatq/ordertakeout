import { listAccountOrders } from "@/lib/accounts/orders";
import { customerAccountFromRequest } from "@/lib/api/context";
import { ok, unauthorized } from "@/lib/api/envelope";
import { serverEnv } from "@/lib/env";
import { normalizeTime, storeToday } from "@/lib/scheduling/time";

/**
 * A customer's own order history.
 *
 * Unlike the single-order endpoint, this one needs a session: an order key
 * opens one order because the person was sent it, whereas a history is
 * everything they have ever bought and is worth more to somebody who should not
 * have it.
 */
export async function GET(request: Request): Promise<Response> {
  const accountId = await customerAccountFromRequest(request);
  if (!accountId) return unauthorized();

  const history = await listAccountOrders(accountId);

  return ok({
    today: storeToday(new Date(), serverEnv().STORE_TIMEZONE),
    orders: history.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      pickupDate: order.pickupDate,
      // HH:mm on the wire, whatever shape the column came back in.
      pickupTime: normalizeTime(order.pickupTime),
      totalCents: order.totalCents,
      currency: order.currency,
      pickupLocationName: order.pickupLocationName,
      items: order.items,
    })),
  });
}
