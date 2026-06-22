/**
 * editor.ts — typed wrappers for the annotation editor's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin.
 */
import { invoke } from "@tauri-apps/api/core";
export { dragOut } from "./hudIpc";

export interface EditorSource {
  imageDataUrl: string;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
}

interface RawEditorSource {
  image_data_url: string;
  width: number;
  height: number;
  origin: string;
  capture_id: number | null;
}

export async function getEditorSource(): Promise<EditorSource> {
  const d = await invoke<RawEditorSource>("editor_source");
  return {
    imageDataUrl: d.image_data_url,
    width: d.width,
    height: d.height,
    origin: d.origin,
    captureId: d.capture_id,
  };
}

export const openEditorFromLast = (): Promise<void> => invoke<void>("editor_open_from_last");
export const openEditorCapture = (id: number): Promise<void> =>
  invoke<void>("editor_open_capture", { id });
export const editorCopy = (pngBase64: string): Promise<void> =>
  invoke<void>("editor_copy", { pngBase64 });
export const editorSave = (pngBase64: string): Promise<string> =>
  invoke<string>("editor_save", { pngBase64 });
export const editorFlattenTemp = (pngBase64: string): Promise<string> =>
  invoke<string>("editor_flatten_temp", { pngBase64 });
