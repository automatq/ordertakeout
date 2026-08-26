import "server-only";

import { z } from "zod";

import {
  addAvailabilityOverride,
  removeAvailabilityOverride,
} from "@/lib/admin/queries";
import { recordAudit } from "@/lib/audit/log";
import { PRODUCT_CONFIG_TAG } from "@/lib/catalog/server";
import { serverEnv } from "@/lib/env";
import { getStoreLocation } from "@/lib/locations/server";
import { storeToday } from "@/lib/scheduling/time";
import { setOrderingPause } from "@/lib/settings/pause";
import { SETTINGS_TAG } from "@/lib/settings/store";

/**
 * The two things staff reach for when service goes wrong: stop taking orders,
 * and say a product has run out today.
 *
 * Lifted out of app/actions/admin.ts so the web dashboard and the staff app run
 * the same code rather than two implementations that drift. The actions and the
 * API routes are both thin adapters over this — they differ only in how they
 * establish who is calling and how they report failure.
 *
 * Everything here assumes authorisation has already happened. Each caller does
 * that its own way: the web action redirects to a login page, the API route
 * returns a 401.
 */

export type ServiceResult = { ok: true } | { ok: false; error: string };

/**
 * How the caller invalidates cached reads.
 *
 * Not called directly here, because the correct primitive depends on where this
 * runs and Next will throw if you get it wrong. A Server Action must use
 * `updateTag`, which expires immediately and gives the dashboard read-your-
 * writes. A Route Handler cannot call that at all and must use
 * `revalidateTag(tag, "max")`, which is stale-while-revalidate.
 *
 * That weaker guarantee is acceptable *only* because nothing on the money path
 * reads through these tags: the checkout guard calls getPauseStateFresh, and
 * availability re-runs inside the reservation lock. The tags cache what staff
 * and customers are shown, not what the shop will accept. If that ever stops
 * being true, this comment is the thing that was wrong.
 */
export type InvalidateTag = (tag: string) => void;

export const pauseInputSchema = z.object({
  scope: z.union([z.literal("global"), z.object({ locationId: z.string().min(1) })]),
  paused: z.boolean(),
  note: z.string().trim().max(200).optional(),
  /** Optional auto-resume, minutes from now. */
  resumeMinutes: z.number().int().min(5).max(24 * 60).optional(),
  staffInitials: z.string().trim().max(6).optional(),
});

export const soldOutInputSchema = z.object({
  productId: z.string().min(1),
  /** Explicit location ids — the quick action fans out one row per location. */
  locationIds: z.array(z.string().min(1)).min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().max(120).optional(),
  staffInitials: z.string().trim().max(6).optional(),
});

export type PauseInput = z.infer<typeof pauseInputSchema>;
export type SoldOutInput = z.infer<typeof soldOutInputSchema>;

/** Uppercased, or null — initials are an attribution, not a name. */
const normaliseInitials = (value: string | undefined): string | null =>
  value?.trim().toUpperCase() || null;

export async function pauseOrdering(
  input: PauseInput,
  invalidate: InvalidateTag,
): Promise<ServiceResult> {
  const { scope, paused, note, resumeMinutes } = input;
  if (scope !== "global" && !(await getStoreLocation(scope.locationId))) {
    return { ok: false, error: "That pickup location is no longer active." };
  }

  const initials = normaliseInitials(input.staffInitials);
  await setOrderingPause(scope, {
    paused,
    /* Both are cleared on resume rather than left behind: a stale "back at 3pm"
       attached to an open shop is worse than no note at all. */
    note: paused ? note?.trim() || null : null,
    resumeAt:
      paused && resumeMinutes ? new Date(Date.now() + resumeMinutes * 60_000).toISOString() : null,
    setBy: initials,
  });
  invalidate(SETTINGS_TAG);

  await recordAudit({
    actorType: "staff",
    actorInitials: initials,
    action: paused ? "ordering.paused" : "ordering.resumed",
    entityType: scope === "global" ? "store" : "location",
    entityId: scope === "global" ? "global" : scope.locationId,
    metadata: { note: note?.trim() || null, resumeMinutes: resumeMinutes ?? null },
  });
  return { ok: true };
}

export async function markSoldOut(
  input: SoldOutInput,
  invalidate: InvalidateTag,
): Promise<ServiceResult> {
  const { productId, locationIds, date, reason } = input;

  const today = storeToday(new Date(), serverEnv().STORE_TIMEZONE);
  /* Yesterday cannot be sold out. Allowing it would write a row nothing ever
     reads, and look like it worked. */
  if (date < today) return { ok: false, error: "Pick today or a future date." };

  for (const locationId of locationIds) {
    if (!(await getStoreLocation(locationId))) {
      return { ok: false, error: "One of those pickup locations is no longer active." };
    }
  }

  const initials = normaliseInitials(input.staffInitials);
  for (const locationId of locationIds) {
    await addAvailabilityOverride({
      productId,
      locationId,
      date,
      reason: reason?.trim() || null,
      createdBy: initials,
    });
  }
  invalidate(PRODUCT_CONFIG_TAG);

  await recordAudit({
    actorType: "staff",
    actorInitials: initials,
    action: "product.86ed",
    entityType: "product",
    entityId: productId,
    metadata: { date, locationIds, reason: reason?.trim() || null },
  });
  return { ok: true };
}

export async function clearSoldOut(
  id: string,
  invalidate: InvalidateTag,
  staffInitials?: string,
): Promise<ServiceResult> {
  await removeAvailabilityOverride(id);
  invalidate(PRODUCT_CONFIG_TAG);

  await recordAudit({
    actorType: "staff",
    actorInitials: normaliseInitials(staffInitials),
    action: "product.86_removed",
    entityType: "product",
    entityId: id,
  });
  return { ok: true };
}
