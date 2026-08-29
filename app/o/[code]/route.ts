import { NextResponse } from "next/server";

import {
  createOrderAccessToken,
  parseOrderShortCode,
  verifyOrderShortToken,
} from "@/lib/orders/access";
import { getOrderByNumber } from "@/lib/orders/lookup";

/**
 * SMS-sized tracking link: `/o/T8BUCXGGKJzJ9PzI` → the full order page.
 *
 * A route handler rather than a page so this costs no React render and can
 * return a real 302. It re-derives the destination from the order itself, so
 * the short link is shorthand for the existing access check and never a second
 * way around it.
 *
 * The redirect is deliberately relative. Routing through `orderTrackingUrl`
 * would tie this to STORE_PUBLIC_URL — breaking every short link in dev and on
 * previews where it is unset, and worse, bouncing a preview visitor onto the
 * production host when it is. Relative keeps the customer on whatever origin
 * they arrived at.
 *
 * Every rejection lands on the same lookup page. Distinguishing "no such order"
 * from "wrong token" would turn this into an order-number oracle.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const parsed = parseOrderShortCode(code);
  if (!parsed) return notFoundRedirect();

  const order = await getOrderByNumber(parsed.orderNumber);
  if (!order) return notFoundRedirect();
  if (!verifyOrderShortToken(order.id, order.orderNumber, parsed.token)) {
    return notFoundRedirect();
  }

  const key = createOrderAccessToken(order.id, order.orderNumber);
  return redirectTo(
    `/orders/${encodeURIComponent(order.orderNumber)}?key=${encodeURIComponent(key)}`,
  );
}

/** Send unknown codes to order lookup, where the customer can type their number. */
function notFoundRedirect() {
  return redirectTo("/orders?notfound=1");
}

function redirectTo(location: string) {
  return new NextResponse(null, { status: 302, headers: { Location: location } });
}
