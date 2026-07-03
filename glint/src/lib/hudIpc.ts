/**
 * hudIpc.ts — typed wrappers for the Quick Access Overlay (the accumulating
 * post-capture tray, route #/hud). All invoke() arg keys are camelCase.
 * Local-first: no network. Drag-out reuses the proven tauri-plugin-drag path.
 */
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export type TrayItem = {
  id: number;
  /** Absolute path to the capture file (drag / copy-path / reveal source). */
  path: string;
  width: number;
  height: number;
  /** True when saved to the Library — the card shows Reveal instead of Save. */
  saved: boolean;
  /** Small base64 PNG data URL for the card thumbnail. */
  thumb: string;
};

export const trayList = (): Promise<TrayItem[]> => invoke<TrayItem[]>("tray_list");
export const trayCopy = (id: number): Promise<void> => invoke<void>("tray_copy", { id });
export const trayCopyPath = (id: number): Promise<void> => invoke<void>("tray_copy_path", { id });
export const traySave = (id: number): Promise<string> => invoke<string>("tray_save", { id });
export const trayReveal = (id: number): Promise<void> => invoke<void>("tray_reveal", { id });
export const trayPin = (id: number): Promise<void> => invoke<void>("tray_pin", { id });
export const trayAnnotate = (id: number): Promise<void> => invoke<void>("tray_annotate", { id });
export const trayExtractText = (id: number): Promise<void> => invoke<void>("tray_extract_text", { id });
export const trayDismiss = (id: number): Promise<void> => invoke<void>("tray_dismiss", { id });
export const trayClear = (): Promise<void> => invoke<void>("tray_clear");
export const trayResize = (height: number): Promise<void> => invoke<void>("tray_resize", { height });

// A 1×1 transparent PNG drag icon so dragging shows only the OS cursor — not a big
// image ghost. Pre-fetched at module load because the OS drag must start
// synchronously inside the pointerdown gesture.
let blankDragIcon: string | null = null;
void invoke<string>("drag_blank_icon").then((p) => { blankDragIcon = p; }).catch(() => {});

/** Drag the real file out into any app (blank drag icon → just the cursor). */
export function dragOut(path: string): void {
  void startDrag({ item: [path], icon: blankDragIcon ?? path, mode: "copy" });
}
