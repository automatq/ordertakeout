import * as Haptics from "expo-haptics";

/**
 * Haptics for the counter.
 *
 * Deliberately more restrained than the customer app's. This runs for a whole
 * shift on a device that lives face-up next to a till, and something that buzzes
 * at every touch stops being information within an hour. So the weight is on
 * outcomes — a pass verified, a pass refused, a tray taken off the menu — and
 * ordinary navigation stays quiet or light.
 *
 * The one this exists for is the scan. Confirming a pickup means looking at a
 * customer, not at a screen, and `success` against `error` is the difference
 * between handing the trays over and not.
 *
 * Nothing is awaited and nothing can throw: iPads have no taptic engine at all,
 * and a counter tablet silently getting no feedback is fine where a crashed
 * confirm screen is not.
 */

/** Collapses a burst into one buzz — see the customer app's copy of this. */
const MIN_GAP_MS = 30;
let lastFiredAt = 0;

function fire(effect: () => Promise<void>): void {
  const now = Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;
  void effect().catch(() => {});
}

/** Something registered: a code was read, a filter changed. */
export const select = () => fire(() => Haptics.selectionAsync());

/** An ordinary button. */
export const tap = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** The screen's main action. */
export const commit = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** It worked: the pass is good, the order is theirs, the change went through. */
export const success = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/**
 * It worked, but something needs a human later.
 *
 * Held apart from `success` for one case that matters: a pickup that verified
 * locally while the Square sync failed. The customer still gets their trays, so
 * refusing would be wrong, but somebody has to reconcile it — and a shift that
 * felt plain success will never know.
 */
export const warning = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** It did not work. On the scan screen this is the whole point. */
export const error = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
