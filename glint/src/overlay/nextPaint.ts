/**
 * nextPaint.ts — resolve *after* the browser has committed a paint.
 *
 * Why two frames: a single requestAnimationFrame callback runs BEFORE the paint
 * of the frame it's scheduled in. To be sure a DOM change we just made has
 * actually reached the screen, we wait for the NEXT rAF after that — by which
 * point the first frame (carrying our change) has been painted/composited.
 *
 * The overlay uses this so the backend can hide the window only once its cleared
 * (transparent) state is truly on the GPU surface — otherwise the hidden window
 * retains the previous capture's frozen frame and flashes it on the next cold
 * show (see overlay.rs `teardown_all`).
 *
 * `raf` is injectable so the two-frame timing is unit-testable without a real
 * compositor. Falls back to a macrotask when rAF is unavailable (plain Vite/JSDOM).
 */
export function nextPaint(
  raf: ((cb: () => void) => void) | undefined =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame : undefined,
): Promise<void> {
  const schedule = raf ?? ((cb: () => void) => setTimeout(cb, 0));
  return new Promise<void>((resolve) => {
    schedule(() => schedule(() => resolve()));
  });
}
