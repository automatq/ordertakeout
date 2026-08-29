"use client";

import { useEffect } from "react";

/**
 * Installs the service worker that keeps this order's pickup pass readable
 * offline. See public/sw.js for what it does and, more importantly, the long
 * list of what it refuses to do.
 *
 * Mounted next to the pass itself rather than in the root layout, so the worker
 * only ever installs for a customer who has a live paid order to collect —
 * never for someone browsing the menu, and never on the staff dashboard.
 */
export function OfflinePassRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Fire and forget: an unavailable worker (insecure context, private mode,
    // user policy) costs the customer nothing but the offline copy.
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
