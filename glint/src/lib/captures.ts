/**
 * captures.ts — typed wrappers for the Library's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin.
 */
import { invoke } from "@tauri-apps/api/core";
export { dragOut } from "./hudIpc";

export interface CaptureItem {
  id: number;
  kind: string;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: number; // unix seconds
  thumb_data_url: string | null;
}

export const listCaptures = (): Promise<CaptureItem[]> => invoke<CaptureItem[]>("captures_list");
export const openCapture = (id: number): Promise<void> => invoke<void>("capture_open", { id });
export const revealCapture = (id: number): Promise<void> => invoke<void>("capture_reveal", { id });
export const copyCapture = (id: number): Promise<void> => invoke<void>("capture_copy", { id });
export const copyCapturePath = (id: number): Promise<void> => invoke<void>("capture_copy_path", { id });
export const deleteCapture = (id: number): Promise<void> => invoke<void>("capture_delete", { id });
