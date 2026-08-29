/**
 * Bebas Neue's iOS glyph box is taller than its nominal point size. A line
 * height below this clips capital strokes in React Native, especially at the
 * top of a screen where there is no overflow room to hide it.
 */
export const DISPLAY_SAFE_LINE_HEIGHT = 1.16;

/** The actual line box used by every display heading, price, and order code. */
export function displayLineHeight(size: number): number {
  return size * DISPLAY_SAFE_LINE_HEIGHT;
}

/**
 * Keeps an intentionally compact multi-line treatment visually dense without
 * asking the native text renderer to crop the font into a too-small line box.
 */
export function compactDisplayLinePull(size: number, scale: number, desiredLeading: number): number {
  return size * scale * (desiredLeading - DISPLAY_SAFE_LINE_HEIGHT);
}
