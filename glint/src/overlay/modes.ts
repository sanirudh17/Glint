/**
 * modes.ts — geometry helpers for the capture overlay.
 *
 * Re-exports Rect from captureIpc so Tasks 9–12 can import everything they
 * need from a single overlay-local module without reaching up into lib/.
 */
import type { WindowRect } from "../lib/captureIpc";
export type { Rect } from "../lib/captureIpc";

/**
 * Normalise two arbitrary corner points into a well-formed Rect.
 * Works regardless of which corner the user started dragging from.
 *
 * @param ax  X of the anchor point (mouse-down position).
 * @param ay  Y of the anchor point.
 * @param bx  X of the current point (mouse position / mouse-up).
 * @param by  Y of the current point.
 */
export function normalizeRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): import("../lib/captureIpc").Rect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(ax - bx),
    h: Math.abs(ay - by),
  };
}

/**
 * Convert a WindowRect (from OverlayData.windows) into a plain Rect,
 * dropping the window id so it matches the Rect shape expected by commitCapture.
 */
export const rectFromWindow = (w: WindowRect): import("../lib/captureIpc").Rect => ({
  x: w.x,
  y: w.y,
  w: w.w,
  h: w.h,
});

/**
 * Topmost window containing the point (x, y) in logical/CSS px.
 * `windows` MUST be ordered topmost-first (the backend enumerates EnumWindows
 * order). Mirrors the Rust `window_at` hit-test exactly.
 */
export function windowAt(
  windows: WindowRect[],
  x: number,
  y: number,
): WindowRect | undefined {
  return windows.find(
    (w) => x >= w.x && y >= w.y && x < w.x + w.w && y < w.y + w.h,
  );
}
