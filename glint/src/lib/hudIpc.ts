/**
 * hudIpc.ts — typed wrappers for the post-capture HUD commands.
 *
 * The HUD webview (#/hud) reads the current capture result from Rust and fires
 * action commands. All invoke() arg keys are camelCase; the backend returns
 * snake_case (image_data_url), mapped here so callers see camelCase.
 *
 * Local-first: no network. Drag-out reuses the proven tauri-plugin-drag path.
 */
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export type HudData = {
  /** Absolute path to the capture's file (drag-out / copy-path / save src). */
  path: string;
  width: number;
  height: number;
  /** Mapped from backend `image_data_url`. Full data:image/png;base64,… URL. */
  imageDataUrl: string;
  /** True when the capture was auto-saved — the HUD shows Reveal instead of Save. */
  saved: boolean;
};

interface RawHudData {
  path: string;
  width: number;
  height: number;
  image_data_url: string;
  saved: boolean;
}

/** Fetch the current capture result (thumbnail + path + dimensions). */
export async function getHudData(): Promise<HudData> {
  const d = await invoke<RawHudData>("hud_data");
  return {
    path: d.path,
    width: d.width,
    height: d.height,
    imageDataUrl: d.image_data_url,
    saved: d.saved,
  };
}

/** Re-copy the capture image to the clipboard. */
export const hudCopy = (): Promise<void> => invoke<void>("hud_copy");

/** Copy the capture's file path to the clipboard as text. */
export const hudCopyPath = (): Promise<void> => invoke<void>("hud_copy_path");

/** Save a copy into the default folder (<Pictures>/Glint) with a timestamped name.
 *  Resolves to the destination path. */
export const hudSave = (): Promise<string> => invoke<string>("hud_save");

/** Reveal the (already auto-saved) capture in Explorer. */
export const hudReveal = (): Promise<void> => invoke<void>("hud_reveal");

/** Close the HUD window. */
export const hudDismiss = (): Promise<void> => invoke<void>("hud_dismiss");

// A 1×1 transparent PNG used as the drag preview so dragging shows only the OS
// drag cursor — not a big ghost of the image. Pre-fetched at module load because
// the OS drag must start synchronously inside the pointerdown gesture (awaiting
// inside dragOut would drop the gesture and the drag wouldn't begin).
let blankDragIcon: string | null = null;
void invoke<string>("drag_blank_icon").then((p) => { blankDragIcon = p; }).catch(() => {});

/**
 * Drag the real file out into any app (proven plugin path). Uses a blank 1×1
 * drag icon so there's no oversized image-preview ghost — just the cursor. Falls
 * back to the file itself as the icon if the blank one isn't ready yet (rare).
 */
export function dragOut(path: string): void {
  // mode: "copy" — drops a copy, leaving Glint's temp file in place.
  void startDrag({ item: [path], icon: blankDragIcon ?? path, mode: "copy" });
}
