/**
 * pin.ts — typed wrappers for the Pin-to-Screen Rust commands.
 * Local-first: only @tauri-apps/api. No recorder coupling.
 */
import { invoke } from "@tauri-apps/api/core";

export interface PinData {
  imageDataUrl: string;
  width: number;
  height: number;
}

interface RawPinData {
  image_data_url: string;
  width: number;
  height: number;
}

/** The current pin window's image (resolved by window label in Rust). */
export async function getPinData(): Promise<PinData> {
  const d = await invoke<RawPinData>("pin_data");
  return { imageDataUrl: d.image_data_url, width: d.width, height: d.height };
}

export const pinCreateFromLast = (): Promise<void> => invoke<void>("pin_create_from_last");
export const pinCreateFromCapture = (id: number): Promise<void> =>
  invoke<void>("pin_create_from_capture", { id });
export const pinSave = (): Promise<string> => invoke<string>("pin_save");
export const pinCopy = (): Promise<void> => invoke<void>("pin_copy");
export const pinClose = (): Promise<void> => invoke<void>("pin_close");
