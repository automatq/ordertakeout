import { toMenuProduct } from "@/lib/api/dto";
import { fail, ok } from "@/lib/api/envelope";
import { groupByCategory } from "@/lib/catalog/categories";
import { getOrderableProducts } from "@/lib/catalog/server";
import { getInStockVariationIds } from "@/lib/inventory/server";
import { variantAvailabilityBatches } from "@/lib/inventory/map";
import { getStoreLocation } from "@/lib/locations/server";

/**
 * The menu, for the customer app.
 *
 * Public, like the storefront it mirrors — a menu is the one thing a bakery
 * wants read by as many people as possible, and there is nothing here a
 * customer could not see by loading the website.
 *
 * `locationId` is optional. Without one the menu still lists everything, with
 * availability reported as unknown rather than assumed: the app renders that
 * state explicitly, because "we are not sure" and "yes, we have it" are very
 * different promises to make to somebody about to pay.
 */
export async function GET(request: Request): Promise<Response> {
  const catalog = await getOrderableProducts();
  if (catalog.error) {
    return fail("unavailable", "The menu is briefly unavailable. Try again in a moment.");
  }

  const url = new URL(request.url);

  /* Prefer the configured public URL, because behind a proxy the request's own
     origin can be an internal address the phone cannot reach. Falling back to
     the request origin keeps this working in development, where nobody has set
     STORE_PUBLIC_URL. */
  const base = process.env.STORE_PUBLIC_URL?.trim() || url.origin;

  const requested = url.searchParams.get("locationId");
  /* An unknown location is treated as none rather than as an error: the menu is
     still worth showing, and the app will ask for a location anyway. */
  const locationId = requested && (await getStoreLocation(requested)) ? requested : null;

  let availability: Map<string, boolean> | null = null;
  if (locationId) {
    availability = new Map();
    const variantIds = catalog.products.flatMap((product) =>
      product.variants.map((variant) => variant.id),
    );
    /* Square caps how many variations one inventory call may ask about, so this
       is chunked — see VARIANT_AVAILABILITY_LIMIT. A catalog large enough to
       need several calls is exactly the catalog where silently truncating would
       mark the tail of the menu sold out. */
    for (const batch of variantAvailabilityBatches(variantIds)) {
      const inStock = await getInStockVariationIds(locationId, batch);
      for (const id of batch) availability.set(id, inStock.has(id));
    }
  }

  const groups = groupByCategory(catalog.products);

  return ok({
    locationId,
    groups: groups.map((group) => ({
      category: group.name,
      products: group.products.map((product) => toMenuProduct(product, availability, base)),
    })),
  });
}
