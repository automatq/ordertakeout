import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

/**
 * Lock the app after ten idle minutes.
 *
 * This is the highest-value thing in the app that is not a feature. A counter
 * tablet spends its day face-up, and the queue screen shows customer names,
 * phone numbers and what everyone spent. Three people share the device, and it
 * is as often in front of a customer as behind the counter.
 *
 * Idle means no touches. The queue refreshes itself every fifteen seconds, so
 * anything driven by network activity would keep the session open forever —
 * which is precisely the failure this exists to prevent.
 *
 * Backgrounding is measured by wall clock rather than a timer: `setInterval`
 * does not run reliably while suspended, so a tablet locked in a drawer
 * overnight would come back unlocked. The elapsed time is checked on the way
 * back to the foreground instead.
 */

/**
 * Ten minutes, unless told otherwise.
 *
 * Overridable so the lock can actually be watched happening — on a real handset
 * during QA, and here. A security control nobody has seen fire is a control
 * nobody knows works.
 */
const configured = Number(process.env.EXPO_PUBLIC_LOCK_MINUTES);
const TIMEOUT_MS = Number.isFinite(configured) && configured > 0 ? configured * 60_000 : 10 * 60_000;

/* Coarse enough to be free, fine enough that "ten minutes" is not eleven — but
   never coarser than the timeout itself, or a short override would never fire. */
const CHECK_MS = Math.min(30_000, Math.max(1_000, TIMEOUT_MS / 4));

export function useIdleLock(
  active: boolean,
  onLock: () => void,
  timeoutMs: number = TIMEOUT_MS,
) {
  const lastActive = useRef(Date.now());
  /* Held in a ref so changing the callback does not tear down the listeners and
     silently reset the idle clock. */
  const lock = useRef(onLock);
  lock.current = onLock;

  const touch = useCallback(() => {
    lastActive.current = Date.now();
  }, []);

  useEffect(() => {
    if (!active) return;

    lastActive.current = Date.now();

    const lockIfIdle = () => {
      if (Date.now() - lastActive.current >= timeoutMs) lock.current();
    };

    const timer = setInterval(lockIfIdle, CHECK_MS);

    const subscription = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        // Suspended time counts as idle time.
        lockIfIdle();
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [active, timeoutMs]);

  return touch;
}
