/**
 * captures.ts — typed wrappers for the Library's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin.
 */
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
export { dragOut } from "./hudIpc";

export interface CaptureItem {
  id: number;
  kind: string;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: number; // unix seconds
  title: string | null; // user-assigned custom name
  /** Asset-protocol URL for the thumbnail, or null. Resolved from the backend's
   *  thumb_path so the WebView loads it lazily + natively (no base64 inlining). */
  thumb_url: string | null;
}

/** Wire shape from `captures_list` — carries the thumbnail's filesystem path. */
interface CaptureListRow {
  id: number;
  kind: string;
  path: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  created_at: number;
  title: string | null;
  thumb_path: string | null;
}

/**
 * List captures, newest first. `limit` caps the result — Home previews only the few
 * most recent, so it no longer fetches the whole library. Each thumbnail path is
 * resolved to an asset URL; the WebView then loads thumbnails lazily and natively
 * instead of the backend base64-inlining every one under the DB lock.
 */
export const listCaptures = async (limit?: number): Promise<CaptureItem[]> => {
  const rows = await invoke<CaptureListRow[]>("captures_list", { limit: limit ?? null });
  return rows.map(({ thumb_path, ...r }) => ({
    ...r,
    thumb_url: thumb_path ? convertFileSrc(thumb_path) : null,
  }));
};
export const openCapture = (id: number): Promise<void> => invoke<void>("capture_open", { id });
export const revealCapture = (id: number): Promise<void> => invoke<void>("capture_reveal", { id });
export const copyCapture = (id: number): Promise<void> => invoke<void>("capture_copy", { id });
export const copyCapturePath = (id: number): Promise<void> => invoke<void>("capture_copy_path", { id });
export const deleteCapture = (id: number): Promise<void> => invoke<void>("capture_delete", { id });
export const renameCapture = (id: number, title: string): Promise<void> =>
  invoke<void>("capture_rename", { id, title });
