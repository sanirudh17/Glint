/** fxRender — pure geometry/animation math for the FX overlay canvas. */

/** Physical screen coords → device px on the overlay canvas. The canvas covers the
 * recording area starting at originX/originY physical; canvas.width is sized in
 * device px (logical * scale), so a physical point maps by subtracting the origin
 * and scaling. */
export function toCanvasXY(px: number, py: number, originX: number, originY: number, scale: number) {
  return { x: (px - originX) * scale, y: (py - originY) * scale };
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
