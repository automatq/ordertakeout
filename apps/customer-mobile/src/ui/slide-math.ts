/**
 * The arithmetic behind the slide-to-pay bar, kept out of the component.
 *
 * Not for tidiness: these four functions are the whole of the decision to take
 * someone's money, and the only part of the control that can be checked without
 * a phone in your hand. Everything else in `slide-to-pay.tsx` is transforms and
 * touch plumbing, which a test could only restate.
 */

/**
 * How far along the track a slow, deliberate drag must get before letting go
 * pays. High on purpose — this is the last confirmation before a charge, and a
 * gesture that commits at halfway is one you can make without meaning to.
 */
export const COMMIT_FRACTION = 0.82;

/**
 * Where an armed slider disarms again.
 *
 * The gap between this and `COMMIT_FRACTION` is the point: a finger resting on
 * the threshold wanders by a pixel or two, and a single line would arm and
 * disarm — and buzz — with every one of those wobbles.
 */
export const DISARM_FRACTION = 0.7;

/** px/ms at which a flick counts as intent rather than a slip. */
export const FLING_VX = 0.9;

/** However fast it was thrown, a fling that never left the first half is not a payment. */
export const FLING_MIN_FRACTION = 0.5;

/** Horizontal travel before the bar claims the touch, in points. */
export const DIRECTION_SLOP = 6;

/** Travel available to the thumb. Never negative, however narrow the screen. */
export function travelFor(width: number, inset: number, thumb: number): number {
  return Math.max(0, width - inset * 2 - thumb);
}

/**
 * How far along the drag is, 0 to 1.
 *
 * Returns 0 rather than `NaN` when there is no travel yet — that is the first
 * frame, before `onLayout` has reported a width, and it happens on every mount.
 */
export function slideFraction(dx: number, travel: number): number {
  if (travel <= 0) return 0;
  return Math.min(1, Math.max(0, dx / travel));
}

/**
 * Whether letting go here pays.
 *
 * Two ways to get there, because a slow drag and a flick are both deliberate
 * and only one of them ends up near the far end. The velocity clause has a
 * floor: the finger can outrun the JS thread, so a fast release is trusted
 * about where it was going, but not from a standing start at the left edge.
 */
export function shouldCommit(fraction: number, velocityX: number): boolean {
  if (fraction >= COMMIT_FRACTION) return true;
  return velocityX >= FLING_VX && fraction >= FLING_MIN_FRACTION;
}

/** The hysteresis band: arm above `COMMIT_FRACTION`, disarm only below `DISARM_FRACTION`. */
export function nextArmed(fraction: number, wasArmed: boolean): boolean {
  if (fraction >= COMMIT_FRACTION) return true;
  if (fraction < DISARM_FRACTION) return false;
  return wasArmed;
}
