import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Whether this phone currently has a network at all.
 *
 * Only `isConnected === false` counts as offline — airplane mode, or out of
 * range. NetInfo also reports `isInternetReachable`, and that is deliberately
 * ignored: it answers "can you reach the public internet", which is a different
 * question from "can you reach the shop". A phone on a captive-portal café wifi
 * fails it, and so does a development build talking to a server over a USB
 * tunnel — blocking requests on that signal would break the app precisely where
 * it still works.
 *
 * So this is the cheap, certain half of the answer. The uncertain half stays
 * where it already was: a request that fails comes back as a Result saying so,
 * which is the only test that actually proves anything.
 */

let offline = false;
let started = false;
const listeners = new Set<(value: boolean) => void>();

function publish(next: boolean) {
  if (next === offline) return;
  offline = next;
  for (const listener of listeners) listener(next);
}

/* Subscribed on first use rather than at import, so pulling a type out of this
   module's neighbours in a test does not reach for a native module. */
function ensureSubscribed() {
  if (started) return;
  started = true;
  NetInfo.addEventListener((state) => publish(state.isConnected === false));
}

/** For code outside React — see the fail-fast in api.ts. */
export function isOffline(): boolean {
  ensureSubscribed();
  return offline;
}

export function useOffline(): boolean {
  const [value, setValue] = useState(() => {
    ensureSubscribed();
    return offline;
  });

  useEffect(() => {
    ensureSubscribed();
    listeners.add(setValue);
    /* State can have changed between the first render and this effect. */
    setValue(offline);
    return () => {
      listeners.delete(setValue);
    };
  }, []);

  return value;
}
