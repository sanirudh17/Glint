/** fxRender — pure geometry/animation math for the FX overlay canvas. */

/** Physical screen coords → device px on the overlay canvas. Win32 hook coords and
 * the window origin are BOTH already physical (device) pixels, and the canvas is
 * sized in device px (canvas.width = innerWidth * scale = physical width), so a
 * physical point maps by subtracting the physical origin — NO extra scaling. (An
 * earlier ×scale here over-shifted every point on HiDPI displays, pushing the
 * spotlight/ripples/pointer away from the real cursor, worse the farther out.) */
export function toCanvasXY(px: number, py: number, originX: number, originY: number) {
  return { x: px - originX, y: py - originY };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Ripple radius eases linearly 0→maxR over maxMs, then clamps. */
export function rippleRadius(ageMs: number, maxMs: number, maxR: number): number {
  return clamp01(ageMs / maxMs) * maxR;
}

/** Ripple opacity fades 1→0 over maxMs. */
export function rippleAlpha(ageMs: number, maxMs: number): number {
  return 1 - clamp01(ageMs / maxMs);
}
