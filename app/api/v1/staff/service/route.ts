import { revalidateTag } from "next/cache";
import { z } from "zod";

import { staffDeviceFromRequest } from "@/lib/api/context";
import { fail, ok, unauthorized } from "@/lib/api/envelope";
import { listAvailabilityOverrides } from "@/lib/admin/queries";
import { getOrderableProducts } from "@/lib/catalog/server";
import { serverEnv } from "@/lib/env";
import { getStoreLocationsSafe } from "@/lib/locations/server";
import { storeToday } from "@/lib/scheduling/time";
import { listPauseSettings } from "@/lib/settings/pause";
import {
  clearSoldOut,
  markSoldOut,
  pauseInputSchema,
  pauseOrdering,
  soldOutInputSchema,
} from "@/lib/staff/service-controls";

/**
 * Stop taking orders, and say what has run out.
 *
 * Both live on one route because they are one screen at the counter: something
 * has gone wrong with service and staff need to say so before the next order
 * arrives. The GET is what that screen reads; the POST is the three things it
 * can do.
 *
 * The work itself is in lib/staff/service-controls.ts, which the web dashboard's
 * actions also call — so a rule about, say, refusing a past date exists once
 * rather than twice.
 */

export async function GET(request: Request): Promise<Response> {
  if (!(await staffDeviceFromRequest(request))) return unauthorized();

  const [locations, catalog, overrides] = await Promise.all([
    getStoreLocationsSafe(),
    getOrderableProducts(),
    listAvailabilityOverrides(),
  ]);

  const pause = await listPauseSettings(locations.map((location) => location.id));
  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);

  const productNames = new Map(catalog.products.map((product) => [product.id, product.name]));
  const locationNames = new Map(locations.map((location) => [location.id, location.name]));

  return ok({
    today,
    /* Paused globally is reported separately from paused per branch, because
       resuming one does not resume the other and a single flag would make that
       impossible to express. */
    global: pause.global?.paused
      ? { paused: true, note: pause.global.note, resumeAt: pause.global.resumeAt }
      : { paused: false, note: null, resumeAt: null },
    locations: locations.map((location) => {
      const setting = pause.byLocation[location.id];
      return {
        id: location.id,
        name: location.name,
        paused: setting?.paused ?? false,
        note: setting?.paused ? setting.note : null,
        resumeAt: setting?.paused ? setting.resumeAt : null,
      };
    }),
    /* Only today's. The web dashboard shows the whole upcoming window; at a
       counter, anything but today is noise. */
    soldOut: overrides
      .filter((override) => override.date === today)
      .map((override) => ({
        id: override.id,
        productId: override.productId,
        productName: productNames.get(override.productId) ?? override.productId,
        locationId: override.locationId,
        locationName: override.locationId
          ? locationNames.get(override.locationId) ?? "Former location"
          : "All locations",
        reason: override.reason,
      })),
    products: catalog.products.map((product) => ({ id: product.id, name: product.name })),
  });
}

const bodySchema = z.discriminatedUnion("intent", [
  pauseInputSchema.extend({ intent: z.literal("pause") }),
  soldOutInputSchema.extend({ intent: z.literal("sold-out") }),
  z.object({
    intent: z.literal("back-on"),
    id: z.uuid(),
    staffInitials: z.string().trim().max(6).optional(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  if (!(await staffDeviceFromRequest(request))) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Check the details and try again.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", "Check the details and try again.");

  /* Route handlers cannot call updateTag — see InvalidateTag in the service for
     why the weaker guarantee is safe here. */
  const invalidate = (tag: string) => revalidateTag(tag, "max");

  const result =
    parsed.data.intent === "pause"
      ? await pauseOrdering(parsed.data, invalidate)
      : parsed.data.intent === "sold-out"
        ? await markSoldOut(parsed.data, invalidate)
        : await clearSoldOut(parsed.data.id, invalidate, parsed.data.staffInitials);

  /* A refused change is a 200 with a reason, like the pickup route: "that
     location is no longer active" is something to read at the counter, not a
     complaint that the request was malformed. */
  return result.ok ? ok({ applied: true }) : ok({ applied: false, reason: result.error });
}
