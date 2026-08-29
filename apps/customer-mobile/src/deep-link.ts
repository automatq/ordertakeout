/**
 * Where a link should take somebody.
 *
 * The confirmation email and SMS carry a URL with the order number and the
 * signed key that opens it. Two shapes have to work, because both exist in the
 * wild already:
 *
 *   harina://orders/PT-ABC123?key=…            the app's own scheme
 *   https://harinabakeshoppe.com/orders/PT-…   the website, once universal
 *                                              links are configured
 *
 * Pure and exported so the parsing can be tested without a device — deep links
 * are otherwise the sort of thing only ever exercised by hand, badly.
 */
export type Destination = { kind: "order"; orderNumber: string; accessKey: string } | null;

export function parseDeepLink(url: string): Destination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  /* Both shapes put the order number last. A custom scheme puts the first
     segment in `host`, so read the whole thing rather than trusting pathname. */
  const segments = `${parsed.host}${parsed.pathname}`.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  const isOrders = segments.includes("orders") || segments.includes("o");
  if (!isOrders || !last || last === "orders") return null;

  const accessKey = parsed.searchParams.get("key");
  /* Without a key there is nothing to show. Better to land on the menu than on
     a screen that can only say no. */
  if (!accessKey) return null;

  return { kind: "order", orderNumber: decodeURIComponent(last), accessKey };
}
