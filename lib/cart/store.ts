"use client";

import { useCallback, useSyncExternalStore } from "react";

import { normalizeCart, subtractCartItems, type CartItem } from "@/lib/catalog/cart";

/**
 * Cart state, persisted to localStorage.
 *
 * Only variant ids and quantities are stored — never prices. Prices are resolved
 * server-side from the Square catalog at checkout, so a stale or tampered cart
 * cannot affect what the customer is charged.
 *
 * Implemented with `useSyncExternalStore` rather than useState + useEffect.
 * localStorage *is* an external store, and this is the primitive React provides
 * for one: it handles the server/client snapshot split without a hydration
 * mismatch, and it gives cross-tab synchronisation for free — add a tray in one
 * tab and the other updates.
 */

const STORAGE_KEY = "bakery-cart-v1";

export interface CartSnapshot {
  items: CartItem[];
  /** Location the cart was last reconciled against. */
  locationId: string | null;
  /** False during SSR and hydration, so the UI can avoid a flash of "empty". */
  ready: boolean;
}

/** Stable identity: returning a new object each call would loop forever. */
const SERVER_SNAPSHOT: CartSnapshot = { items: [], locationId: null, ready: false };

let snapshot: CartSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function readStoredCart(): { items: CartItem[]; locationId: string | null } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], locationId: null };
    const parsed: unknown = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];
    const locationId = !Array.isArray(parsed) && parsed && typeof parsed === "object"
      && typeof (parsed as { locationId?: unknown }).locationId === "string"
      ? (parsed as { locationId: string }).locationId
      : null;

    return { locationId, items: normalizeCart(
      entries.flatMap((entry): CartItem[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const { variantId, quantity } = entry as Partial<CartItem>;
        if (typeof variantId !== "string" || typeof quantity !== "number") return [];
        if (!Number.isInteger(quantity) || quantity < 1) return [];
        return [{ variantId, quantity }];
      }),
    ) };
  } catch {
    // A corrupt or unreadable cart must never break the storefront.
    return { items: [], locationId: null };
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function commit(items: CartItem[], options: { persist?: boolean; locationId?: string | null } = {}) {
  const { persist = true } = options;
  snapshot = {
    items: normalizeCart(items),
    locationId: options.locationId === undefined ? snapshot.locationId : options.locationId,
    ready: true,
  };
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        items: snapshot.items,
        locationId: snapshot.locationId,
      }));
    } catch {
      // Private browsing or a full quota — the cart just won't survive a reload.
    }
  }
  emit();
}

function getSnapshot(): CartSnapshot {
  if (!hydrated) {
    hydrated = true;
    snapshot = { ...readStoredCart(), ready: true };
  }
  return snapshot;
}

const getServerSnapshot = (): CartSnapshot => SERVER_SNAPSHOT;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab changed the cart — re-read rather than clobbering it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    const stored = readStoredCart();
    commit(stored.items, { persist: false, locationId: stored.locationId });
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export interface Cart extends CartSnapshot {
  totalQuantity: number;
  add: (variantId: string, quantity?: number) => void;
  setQuantity: (variantId: string, quantity: number) => void;
  remove: (variantId: string) => void;
  clear: () => void;
  consume: (purchasedItems: readonly CartItem[]) => void;
  reconcileLocation: (locationId: string, retainedItems: readonly CartItem[]) => void;
}

export function useCart(): Cart {
  const { items, locationId, ready } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback((variantId: string, quantity = 1) => {
    commit([...snapshot.items, { variantId, quantity }]);
  }, []);

  const setQuantity = useCallback((variantId: string, quantity: number) => {
    commit(
      snapshot.items.map((item) =>
        item.variantId === variantId ? { ...item, quantity } : item,
      ),
    );
  }, []);

  const remove = useCallback((variantId: string) => {
    commit(snapshot.items.filter((item) => item.variantId !== variantId));
  }, []);

  const clear = useCallback(() => commit([]), []);
  const consume = useCallback((purchasedItems: readonly CartItem[]) => {
    commit(subtractCartItems(snapshot.items, purchasedItems));
  }, []);
  const reconcileLocation = useCallback((nextLocationId: string, retainedItems: readonly CartItem[]) => {
    commit([...retainedItems], { locationId: nextLocationId });
  }, []);

  return {
    items,
    locationId,
    ready,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    add,
    setQuantity,
    remove,
    clear,
    consume,
    reconcileLocation,
  };
}
