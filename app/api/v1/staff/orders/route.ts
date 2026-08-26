import { hasStaffBearer } from "@/lib/api/context";
import { toQueueResponse } from "@/lib/api/dto";
import { ok, unauthorized } from "@/lib/api/envelope";
import { getDashboardData } from "@/lib/orders/dashboard";

/**
 * The order queue, for the staff app.
 *
 * Deliberately not rate limited. This is a polling endpoint — a counter tablet
 * hits it every few seconds all shift — and `consumeRateLimit` is a database
 * write per call, so limiting it would cost more than it protects. It is behind
 * a bearer token, which is the control that matters.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await hasStaffBearer(request))) return unauthorized();

  const url = new URL(request.url);
  const locationId = url.searchParams.get("locationId") ?? undefined;

  // Never cached: a kitchen screen showing a stale queue is worse than a slow one.
  const data = await getDashboardData(7, locationId);

  /* Serialised through an explicit DTO, never the raw row — see lib/api/dto.ts
     for what `Order` actually carries. */
  return ok(toQueueResponse(data));
}
