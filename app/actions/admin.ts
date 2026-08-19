"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { requireStaffSession } from "@/lib/auth/guard";
import {
  addBlackoutDate,
  clearSlotCapacity,
  removeBlackoutDate,
  saveProductRules,
  setSlotCapacity,
} from "@/lib/admin/queries";
import {
  blackoutSchema,
  parsePickupTimes,
  productRulesSchema,
  slotCapacitySchema,
  warnAboutRules,
} from "@/lib/admin/validate";
import { CATALOG_TAG, PRODUCT_CONFIG_TAG } from "@/lib/catalog/server";

/**
 * Admin actions.
 *
 * Every one re-checks the session — server actions are independently addressable
 * endpoints, so a page-level guard alone would leave them open.
 *
 * Every write that changes what the storefront shows invalidates the cached
 * catalog. Without that, staff would change a cutoff, see no difference, and
 * reasonably conclude the form is broken.
 */

export type AdminResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const flatten = (error: z.ZodError): Record<string, string[]> =>
  z.flattenError(error).fieldErrors as Record<string, string[]>;

export async function saveProductRulesAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = productRulesSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flatten(parsed.error) };
  }

  const times = parsePickupTimes(parsed.data.pickupTimes);
  if (!times.ok) {
    return {
      ok: false,
      error:
        times.invalid.length > 0
          ? `Not a valid 24-hour time: ${times.invalid.join(", ")}`
          : "Add at least one pickup time.",
      fieldErrors: { pickupTimes: ["Use 24-hour times, e.g. 16:00, 17:00"] },
    };
  }

  await saveProductRules({
    productId: parsed.data.productId,
    slug: parsed.data.slug,
    leadTimeDays: parsed.data.leadTimeDays,
    orderCutoffTime: parsed.data.orderCutoffTime,
    allowedPickupTimes: times.times,
    maxUnitsPerDay: parsed.data.maxUnitsPerDay,
    isOrderable: parsed.data.isOrderable,
    descriptionMd: parsed.data.descriptionMd ?? null,
  });

  updateTag(PRODUCT_CONFIG_TAG);

  // Saved either way — these are "are you sure?" notes, not errors.
  return {
    ok: true,
    warnings: warnAboutRules({
      leadTimeDays: parsed.data.leadTimeDays,
      orderCutoffTime: parsed.data.orderCutoffTime,
      pickupTimes: times.times,
    }),
  };
}

export async function addBlackoutAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = blackoutSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Pick a valid date.", fieldErrors: flatten(parsed.error) };
  }

  await addBlackoutDate(parsed.data.date, parsed.data.reason || null);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

export async function removeBlackoutAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Pick a valid date." };
  }

  await removeBlackoutDate(date);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

export async function setSlotCapacityAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const parsed = slotCapacitySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the slot details.", fieldErrors: flatten(parsed.error) };
  }

  await setSlotCapacity(parsed.data.pickupDate, parsed.data.pickupTime, parsed.data.maxOrders);
  updateTag(PRODUCT_CONFIG_TAG);
  return {
    ok: true,
    warnings:
      parsed.data.maxOrders === 0
        ? ["A cap of 0 closes that pickup time completely."]
        : undefined,
  };
}

export async function clearSlotCapacityAction(formData: FormData): Promise<AdminResult> {
  await requireStaffSession();

  const pickupDate = String(formData.get("pickupDate") ?? "");
  const pickupTime = String(formData.get("pickupTime") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || !/^\d{2}:\d{2}/.test(pickupTime)) {
    return { ok: false, error: "Pick a valid slot." };
  }

  await clearSlotCapacity(pickupDate, pickupTime);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}

/** Pull fresh item names and prices from Square right now. */
export async function resyncCatalogAction(): Promise<AdminResult> {
  await requireStaffSession();
  updateTag(CATALOG_TAG);
  updateTag(PRODUCT_CONFIG_TAG);
  return { ok: true };
}
