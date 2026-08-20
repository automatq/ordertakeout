"use client";

import { useCallback, useSyncExternalStore } from "react";

const KEY = "bakery-pickup-location-v1";
let current: string | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((listener) => listener()); }
function read() {
  if (!hydrated) {
    hydrated = true;
    try { current = window.localStorage.getItem(KEY); } catch { current = null; }
  }
  return current;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) { current = event.newValue; emit(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}
export function usePickupLocation() {
  const locationId = useSyncExternalStore(subscribe, read, () => null);
  const setLocation = useCallback((id: string | null) => {
    current = id;
    try { id ? window.localStorage.setItem(KEY, id) : window.localStorage.removeItem(KEY); } catch {}
    emit();
  }, []);
  return { locationId, setLocation };
}
