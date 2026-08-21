"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "bakery-pickup-location-v1";
let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();
let checkoutLocationLock: string | null = null;
const lockListeners = new Set<() => void>();

function emit() { listeners.forEach((listener) => listener()); }
function emitLock() { lockListeners.forEach((listener) => listener()); }
function read() {
  if (!hydrated) {
    hydrated = true;
    try { current = window.localStorage.getItem(KEY); } catch { current = null; }
  }
  return current;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY || !isPickupLocationChangeAllowed(event.newValue)) return;
    current = event.newValue;
    emit();
  };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function subscribeLock(listener: () => void) {
  lockListeners.add(listener);
  return () => { lockListeners.delete(listener); };
}

/**
 * A checkout reservation belongs to one Square location. While its card form is
 * active, changing the storefront location would make the global picker and the
 * server-side order disagree. Keep the lock in memory (never localStorage) so it
 * lasts only for this tab's active checkout.
 */
export function acquirePickupLocationLock(locationId: string): boolean {
  if (!locationId || (checkoutLocationLock !== null && checkoutLocationLock !== locationId)) {
    return false;
  }
  if (checkoutLocationLock === locationId) return true;
  checkoutLocationLock = locationId;
  emitLock();
  return true;
}

/** Only the checkout that owns a lock may release it. */
export function releasePickupLocationLock(locationId: string): void {
  if (checkoutLocationLock !== locationId) return;
  checkoutLocationLock = null;
  emitLock();
}

export function isPickupLocationChangeAllowed(locationId: string | null): boolean {
  return checkoutLocationLock === null || checkoutLocationLock === locationId;
}

export function usePickupLocation() {
  const locationId = useSyncExternalStore(subscribe, read, () => null);
  const lockedLocationId = useSyncExternalStore(
    subscribeLock,
    () => checkoutLocationLock,
    () => null,
  );
  const setLocation = useCallback((id: string | null) => {
    if (!isPickupLocationChangeAllowed(id)) return false;
    current = id;
    try { id ? window.localStorage.setItem(KEY, id) : window.localStorage.removeItem(KEY); } catch {}
    emit();
    return true;
  }, []);
  return { locationId, lockedLocationId, setLocation };
}
