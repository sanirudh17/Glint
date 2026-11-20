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
let cachedCaptures: CaptureItem[] | null = null;
let pendingCaptures: Promise<CaptureItem[]> | null = null;
/** Keep the previous object for every capture that didn't change (and the previous
 *  array when nothing did), so a refresh with identical data re-renders nothing —
 *  memoised cards compare by identity. */
function shareUnchanged(previous: CaptureItem[] | null, next: CaptureItem[]): CaptureItem[] {
  if (!previous) return next;
  const byId = new Map(previous.map((item) => [item.id, item]));
  const keys = Object.keys(next[0] ?? {}) as (keyof CaptureItem)[];
  let changed = previous.length !== next.length;
  const merged = next.map((item, index) => {
    const old = byId.get(item.id);
    const same = old !== undefined && keys.every((key) => old[key] === item[key]);
    if (!same || previous[index] !== old) changed = true;
    return same ? old : item;
  });
  return changed ? merged : previous;
}
/** Session snapshot: first navigation paints immediately; refresh reconciles disk. */
export function captureSnapshot(limit?: number): CaptureItem[] {
  return limit === undefined ? cachedCaptures ?? [] : (cachedCaptures ?? []).slice(0, limit);
}
export const listCaptures = async (limit?: number): Promise<CaptureItem[]> => {
  // All callers share one inexpensive metadata request. Home also warms Library.
  const request = pendingCaptures ??= invoke<CaptureListRow[]>("captures_list", { limit: null })
    .then(rows => rows.map(({ thumb_path, ...r }) => ({ ...r, thumb_url: thumb_path ? convertFileSrc(thumb_path) : null })))
    .then(rows => { cachedCaptures = shareUnchanged(cachedCaptures, rows); return cachedCaptures; })
    .finally(() => { pendingCaptures = null; });
  const rows = await request;
  return limit === undefined ? rows : rows.slice(0, limit);
};
export const openCapture = (id: number): Promise<void> => invoke<void>("capture_open", { id });
export const revealCapture = (id: number): Promise<void> => invoke<void>("capture_reveal", { id });
export const copyCapture = (id: number): Promise<void> => invoke<void>("capture_copy", { id });
export const copyCapturePath = (id: number): Promise<void> => invoke<void>("capture_copy_path", { id });
export const deleteCapture = (id: number): Promise<void> => invoke<void>("capture_delete", { id });
export const renameCapture = (id: number, title: string): Promise<void> =>
  invoke<void>("capture_rename", { id, title });
