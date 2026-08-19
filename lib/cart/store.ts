"use client";

import { useCallback, useSyncExternalStore } from "react";

import { normalizeCart, type CartItem } from "@/lib/catalog/cart";

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
  /** False during SSR and hydration, so the UI can avoid a flash of "empty". */
  ready: boolean;
}

/** Stable identity: returning a new object each call would loop forever. */
const SERVER_SNAPSHOT: CartSnapshot = { items: [], ready: false };

let snapshot: CartSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();

function readStoredCart(): CartItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return normalizeCart(
      parsed.flatMap((entry): CartItem[] => {
        if (typeof entry !== "object" || entry === null) return [];
        const { variantId, quantity } = entry as Partial<CartItem>;
        if (typeof variantId !== "string" || typeof quantity !== "number") return [];
        if (!Number.isInteger(quantity) || quantity < 1) return [];
        return [{ variantId, quantity }];
      }),
    );
  } catch {
    // A corrupt or unreadable cart must never break the storefront.
    return [];
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function commit(items: CartItem[], { persist = true } = {}) {
  snapshot = { items: normalizeCart(items), ready: true };
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot.items));
    } catch {
      // Private browsing or a full quota — the cart just won't survive a reload.
    }
  }
  emit();
}

function getSnapshot(): CartSnapshot {
  if (!hydrated) {
    hydrated = true;
    snapshot = { items: readStoredCart(), ready: true };
  }
  return snapshot;
}

const getServerSnapshot = (): CartSnapshot => SERVER_SNAPSHOT;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Another tab changed the cart — re-read rather than clobbering it.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    commit(readStoredCart(), { persist: false });
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
}

export function useCart(): Cart {
  const { items, ready } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

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

  return {
    items,
    ready,
    totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
    add,
    setQuantity,
    remove,
    clear,
  };
}
