/**
 * captureIpc.ts — typed wrappers for the Tauri capture overlay commands.
 *
 * All invoke() arg keys are camelCase (Tauri serde mapping).
 * The backend returns snake_case fields in OverlayData; we map them here
 * so callers always see camelCase TypeScript.
 *
 * Local-first: no network. Only @tauri-apps/api imports.
 */
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { loadFrameWith, decodeDataUrl, type LoadedFrame } from "../overlay/overlayFrame";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Rect = { x: number; y: number; w: number; h: number };

export type WindowRect = { id: number; x: number; y: number; w: number; h: number };

export type CaptureMode = "area" | "fullscreen" | "window";

export type OverlayData = {
  width: number;
  height: number;
  scale: number;
  mode: CaptureMode;
  /** Mapped from backend snake_case `image_data_url`. Full data:image/png;base64,… URL. */
  imageDataUrl: string;
  /** Window rects in logical/CSS px. */
  windows: WindowRect[];
  /**
   * Cursor position (logical/CSS px) when the overlay loaded, or null if the OS
   * position couldn't be read. Lets the loupe render on the first paint — a
   * stationary pointer fires no pointermove, so the webview has no other way to
   * know where the mouse is. Mapped from snake_case `cursor_x`/`cursor_y`.
   */
  cursorX: number | null;
  cursorY: number | null;
};

// ─── Raw backend shape (snake_case) ──────────────────────────────────────────

interface RawOverlayData {
  width: number;
  height: number;
  scale: number;
  mode: CaptureMode;
  image_data_url: string;
  windows: WindowRect[];
  cursor_x: number | null;
  cursor_y: number | null;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Fetch AND decode the frozen frame for the given monitor (Plan A: "decode-then-
 * show"). The decode runs while the overlay window is still hidden, so showing it
 * only has to composite an already-decoded image — killing the ~1s cold-idle
 * repaint stall. Returns timings for the [perf] confirmation log.
 */
export function loadOverlayFrame(monitorId: number): Promise<LoadedFrame<OverlayData>> {
  return loadFrameWith(() => getOverlayData(monitorId), decodeDataUrl);
}

/**
 * Tell the backend the overlay has fetched + decoded the new frozen frame and is
 * ready to be shown. Carries the fetch/decode timings for the [perf] log. Errors
 * are swallowed — a missing signal just means the backend shows on its timeout.
 */
export function signalOverlayReady(fetchMs: number, decodeMs: number): Promise<void> {
  return emit("overlay-ready", { fetchMs, decodeMs }).catch(() => {});
}

/**
 * Fetch the frozen screenshot and window list for the given monitor.
 * Maps `image_data_url` → `imageDataUrl` so TypeScript callers use camelCase.
 *
 * @param monitorId  The monitor index (NOT monitor_id — Tauri deserialises camelCase).
 */
export async function getOverlayData(monitorId: number): Promise<OverlayData> {
  const d = await invoke<RawOverlayData>("capture_overlay_data", { monitorId });
  return {
    width: d.width,
    height: d.height,
    scale: d.scale,
    mode: d.mode,
    imageDataUrl: d.image_data_url,
    windows: d.windows,
    cursorX: d.cursor_x,
    cursorY: d.cursor_y,
  };
}

// Once a commit or cancel fires, the backend takes the session and tears the
// overlay window down. Any later commit/cancel from this same overlay (Enter
// then click, a second mode's handler, a stray Esc) would only hit "no active
// capture session" and surface as an unhandled rejection. This webview is
// single-capture and short-lived, so a module-level latch makes the first call
// win and turns the rest into harmless no-ops.
let settled = false;

/**
 * Reset the single-capture latch. The overlay window is now REUSED across
 * captures (pre-warmed, hidden between uses), so each new capture must clear the
 * latch — otherwise the first commit/cancel would have permanently disarmed it.
 * Called by OverlayApp when it receives `overlay-refresh`.
 */
export function resetCaptureLatch(): void {
  settled = false;
}

/**
 * Commit the selected rect as a capture.
 * rect must be in logical/CSS px (same coordinate space as WindowRect).
 *
 * @param rect       Selection in logical px.
 * @param monitorId  The monitor index (camelCase — see above).
 */
export function commitCapture(rect: Rect, monitorId: number): Promise<void> {
  if (settled) return Promise.resolve();
  settled = true;
  // The backend tears the overlay down regardless; swallow any error (e.g. an
  // empty selection slipped past the client guard, or plain-Vite with no Tauri)
  // so it never becomes an unhandled rejection.
  return invoke<void>("capture_commit", { rect, monitorId }).catch(() => {});
}

/**
 * Begin a capture from the main-window UI (Home quick-start buttons).
 * The backend hides the main window first so Glint isn't in the frozen frame,
 * then opens the overlay. Hotkeys/tray bypass this and call begin directly.
 */
export const startCapture = (mode: CaptureMode): Promise<void> =>
  invoke<void>("capture_start", { mode });

/**
 * Cancel the capture and close the overlay window.
 */
export function cancelCapture(): Promise<void> {
  if (settled) return Promise.resolve();
  settled = true;
  return invoke<void>("capture_cancel").catch(() => {});
}
