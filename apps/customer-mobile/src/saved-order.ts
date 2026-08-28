import * as SecureStore from "expo-secure-store";

import type { CustomerOrder } from "./api";

/**
 * The last order this phone was shown, kept so it survives having no signal.
 *
 * This is the entire reason the pickup pass is worth putting in an app. The pass
 * is a static signature over the order — it does not expire and needs no network
 * to be valid — so storing it at the moment the order is opened means it can be
 * held up at a counter in a shop with thick walls and no bars, which is exactly
 * where people need it and exactly where a website fails them.
 *
 * The key travels with it because refreshing the order needs it again, and the
 * customer will not have the email to hand.
 */

const KEY = "harina.order";

export interface SavedOrder {
  orderNumber: string;
  accessKey: string;
  order: CustomerOrder;
  /** When this copy was taken, so the screen can admit it might be stale. */
  savedAt: string;
}

export async function loadSavedOrder(): Promise<SavedOrder | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedOrder;
    /* A stored shape from an older build is worse than nothing: it would render
       as a broken screen rather than an absent one. */
    if (!parsed?.orderNumber || !parsed?.accessKey || !parsed?.order) return null;
    /* A copy written before `cancellation` existed would otherwise crash the
       screen that reads it. Defaulting to "cannot cancel" is also the right
       answer on its own terms: cancelling needs the network, so a decision made
       from a stored copy is one nobody should be acting on. */
    return parsed.order.cancellation
      ? parsed
      : { ...parsed, order: { ...parsed.order, cancellation: { allowed: false, reason: null } } };
  } catch {
    return null;
  }
}

export async function saveOrder(
  orderNumber: string,
  accessKey: string,
  order: CustomerOrder,
): Promise<void> {
  const saved: SavedOrder = { orderNumber, accessKey, order, savedAt: new Date().toISOString() };
  await SecureStore.setItemAsync(KEY, JSON.stringify(saved));
}

export async function forgetOrder(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
