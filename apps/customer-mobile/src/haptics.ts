import * as Haptics from "expo-haptics";

/**
 * Haptics, named by what happened rather than how it feels.
 *
 * Call sites say `select()` or `commit()`, not "medium impact", so the physical
 * vocabulary can be tuned in one place instead of being re-litigated per screen.
 * That matters more than it sounds: haptics stop meaning anything the moment
 * every tap feels the same, and the only way to keep them distinct is to keep
 * the mapping somewhere you can read all at once.
 *
 * Nothing here is awaited and nothing here can throw. A device with no taptic
 * engine, an Android build without the vibrate permission, and a simulator all
 * reject these promises, and none of that is a reason for a button not to work.
 *
 * iOS already honours the system-wide haptics switch, so there is no in-app
 * setting to duplicate it.
 */

/**
 * Collapses a burst into one buzz.
 *
 * Two things fire together more often than you would expect — a control that
 * feeds back on its own press plus a screen that reacts to the state change —
 * and the result is a rattle rather than a tap. Well below the ~50ms at which
 * two pulses stop being separable, so deliberate fast tapping still feels like
 * one tap per press.
 */
const MIN_GAP_MS = 30;
let lastFiredAt = 0;

function fire(effect: () => Promise<void>): void {
  const now = Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;
  void effect().catch(() => {});
}

/** A value changed: a chip, a tab, a quantity. The lightest thing there is. */
export const select = () => fire(() => Haptics.selectionAsync());

/** An ordinary button that does something. */
export const tap = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/**
 * The screen's primary button — the filled brand one, and the sticky bar on
 * every step of the order path.
 *
 * Weight tracks visual prominence rather than consequence, deliberately: the
 * rule stays predictable, and it is one a future button gets right by being
 * styled correctly instead of by someone remembering to pick a feeling. Whether
 * the action actually worked is what `success` and `error` are for.
 */
export const commit = () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** It worked: the order is in, the code was accepted. */
export const success = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));

/** It did not work, and there is a message on screen explaining why. */
export const error = () =>
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
