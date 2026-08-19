"use server";

import { updateTag } from "next/cache";

import { CATALOG_TAG, PRODUCT_CONFIG_TAG } from "@/lib/catalog/server";

/**
 * Force a catalog refresh.
 *
 * The catalog is cached for hours, which is right for page views but wrong right
 * after staff change a price in the Square Dashboard. This backs the "re-sync"
 * button on the admin screen so they don't have to wait for the cache to lapse
 * or ask someone to redeploy.
 *
 * `updateTag` rather than `revalidateTag`: Next 16 expires the tag immediately
 * and gives read-your-own-writes within the same action, so staff see the new
 * prices on the very next render instead of possibly being served one more stale
 * response — which would read as the re-sync button not working.
 */
export async function resyncCatalog(): Promise<void> {
  updateTag(CATALOG_TAG);
  updateTag(PRODUCT_CONFIG_TAG);
}
