"use client";

/**
 * The new-order chime.
 *
 * Synthesised with the Web Audio API rather than shipping an audio file — no
 * asset to load, and it can't fail to fetch on a slow kitchen tablet.
 *
 * Browsers block audio until the user has interacted with the page, which is why
 * the dashboard has an explicit "enable sound" control: staff tap it once at the
 * start of a shift, which both primes the AudioContext and makes it obvious
 * whether alerts are actually on.
 */

let context: AudioContext | null = null;

export function primeChime(): boolean {
  try {
    context ??= new AudioContext();
    void context.resume();
    return true;
  } catch {
    return false;
  }
}

export function isChimeReady(): boolean {
  return context?.state === "running";
}

/** Two rising notes — audible over a kitchen without being alarming. */
export function playChime(): void {
  if (!context || context.state !== "running") return;

  const now = context.currentTime;
  for (const [index, frequency] of [880, 1318.5].entries()) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = frequency;

    const start = now + index * 0.16;
    // Ramped rather than switched, so it doesn't click.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  }
}
