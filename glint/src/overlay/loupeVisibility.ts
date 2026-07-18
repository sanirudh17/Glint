/**
 * loupeVisibility.ts — when the capture loupe (the zoomed pixel-peeper beside the
 * cursor) is on screen, and where it starts.
 *
 * The bug this exists to prevent: the loupe used to be gated on a `cursor` state
 * that was ONLY ever written by a `pointermove` handler. The overlay window is
 * shown under a stationary mouse, and Windows sends no WM_MOUSEMOVE for a
 * stationary pointer — so the webview never learned where the cursor was and the
 * loupe stayed hidden until the user jiggled the mouse. It looked intermittent
 * only because an incidental hand twitch often supplied that first move.
 *
 * The webview cannot discover the pointer position on its own; the backend can
 * (GetCursorPos). So the frozen-frame payload carries the cursor position and we
 * SEED the state with it — the loupe is correct on the very first paint, with no
 * mouse movement required. This mirrors the same-shaped fix for the crosshair
 * cursor in `overlay.rs` (set_cursor_icon on show).
 *
 * Pure + Tauri-free so the gate is unit-testable.
 */

export interface Point {
  x: number;
  y: number;
}

export interface LoupeGate {
  /** Cursor position in logical/CSS px, or null if genuinely unknown. */
  cursor: Point | null;
  /** The frozen frame has been decoded into an ImageBitmap the loupe can sample. */
  hasBitmap: boolean;
  /** A settled selection exists (loupe hides so it doesn't obscure the result). */
  hasRect: boolean;
  /** A drag (draw/move/resize) is in flight. */
  interacting: boolean;
}

/**
 * Seed the cursor state from the backend-supplied position.
 *
 * Returns null when the backend couldn't read the cursor (it is best-effort), in
 * which case the first pointermove takes over — i.e. the old behavior, never worse.
 */
export function seedCursor(
  cursorX: number | null | undefined,
  cursorY: number | null | undefined,
): Point | null {
  if (typeof cursorX !== "number" || typeof cursorY !== "number") return null;
  if (!Number.isFinite(cursorX) || !Number.isFinite(cursorY)) return null;
  return { x: cursorX, y: cursorY };
}

/**
 * Whether the loupe should render: while aiming (no selection yet) or during an
 * active drag, once we know both the cursor position and the frame to sample.
 */
export function isLoupeVisible(g: LoupeGate): boolean {
  if (!g.cursor || !g.hasBitmap) return false;
  return !g.hasRect || g.interacting;
}
