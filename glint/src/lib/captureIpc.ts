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
};

// ─── Raw backend shape (snake_case) ──────────────────────────────────────────

interface RawOverlayData {
  width: number;
  height: number;
  scale: number;
  mode: CaptureMode;
  image_data_url: string;
  windows: WindowRect[];
}

// ─── Commands ─────────────────────────────────────────────────────────────────

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
  };
}

/**
 * Commit the selected rect as a capture.
 * rect must be in logical/CSS px (same coordinate space as WindowRect).
 *
 * @param rect       Selection in logical px.
 * @param monitorId  The monitor index (camelCase — see above).
 */
export const commitCapture = (rect: Rect, monitorId: number): Promise<void> =>
  invoke<void>("capture_commit", { rect, monitorId });

/**
 * Cancel the capture and close the overlay window.
 */
export const cancelCapture = (): Promise<void> =>
  invoke<void>("capture_cancel");
