import { z } from "zod";

import { fail, ok } from "@/lib/api/envelope";
import { getCartAvailability } from "@/app/actions/checkout";
import { serverEnv } from "@/lib/env";
import { storeToday } from "@/lib/scheduling/time";

/**
 * Pickup days and times for a cart, at one shop.
 *
 * A thin adapter over the same function the storefront's picker calls — every
 * rule about lead times, cutoffs, closures and slot capacity is in there, and
 * having the app re-derive any of it would be a second opinion about whether an
 * order can be taken.
 *
 * Advisory only, exactly as it is on the web: the same rules run again inside
 * the reservation lock before anything is charged, because a slot can fill
 * between choosing it and paying for it.
 */
const bodySchema = z.object({
  locationId: z.string().min(1),
  cart: z.array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().min(1).max(50),
    }),
  ).min(1).max(30),
});

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", "Check the order and try again.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", "Check the order and try again.");

  const result = await getCartAvailability(parsed.data.cart, parsed.data.locationId);

  /* Refusals come back as 200 with a reason, like the other customer-facing
     routes: "we've paused ordering" is a sentence for the screen, not a claim
     that the request was malformed. */
  if (!result.ok) {
    return ok({
      available: false,
      reason:
        result.problem.kind === "ordering_paused"
          ? result.problem.note || "We've paused online ordering for a moment."
          : "We can't take that order right now.",
    });
  }

  return ok({
    available: true,
    /* The shop's today, so "Tomorrow" on the day picker means tomorrow where
       the cake is — not where the phone is. */
    today: storeToday(new Date(), serverEnv().STORE_TIMEZONE),
    days: result.days.map((day) => ({
      date: day.date,
      hasAvailability: day.hasAvailability,
      slots: day.slots.map((slot) => ({
        time: slot.time,
        available: slot.available,
        /* The engine's reason codes are turned into words here rather than on
           the phone: "sold_out" and "slot_full" are different sentences to a
           customer, and only the server knows which applies. */
        reason: slot.available ? null : reasonFor(slot.reason),
        remaining: slot.remainingOrders ?? null,
      })),
    })),
  });
}

function reasonFor(reason: string | undefined): string {
  switch (reason) {
    case "slot_full":
      return "Fully booked";
    case "sold_out":
    case "product_daily_capacity":
      return "Sold out";
    case "time_passed":
      return "Too late today";
    case "lead_time":
    case "cutoff_passed":
      return "Too soon";
    case "blackout":
      return "Closed";
    default:
      return "Unavailable";
  }
}
