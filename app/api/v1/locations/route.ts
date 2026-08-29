import { toPickupShop } from "@/lib/api/dto";
import { fail, ok } from "@/lib/api/envelope";
import { getStoreLocationsSafe } from "@/lib/locations/server";

/**
 * Where you can collect from.
 *
 * Public, like the menu — these are shop addresses, printed on the door.
 *
 * `getStoreLocationsSafe` swallows a Square outage and returns an empty list,
 * which is right for a storefront page that has other things to render. Here it
 * is the whole response, and "we have no shops" is a very different sentence
 * from "we could not reach Square just now" — so an empty list is reported as
 * unavailable rather than as an answer.
 */
export async function GET(): Promise<Response> {
  const locations = await getStoreLocationsSafe();
  if (locations.length === 0) {
    return fail("unavailable", "Couldn't load the shops. Try again in a moment.");
  }
  return ok({ shops: locations.map(toPickupShop) });
}
