/**
 * editor.ts — typed wrappers for the annotation editor's Rust commands.
 * Local-first: only @tauri-apps/api + the proven drag plugin + dialog plugin.
 */
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { persistSetting, readSetting } from "./ipc";
export { dragOut } from "./hudIpc";

const RECENT_KEY = "recent_projects";
const RECENT_CAP = 8;

export interface EditorSource {
  imageDataUrl: string;
  width: number;
  height: number;
  origin: string;
  captureId: number | null;
  doc: unknown | null;
  projectPath: string | null;
}

interface RawEditorSource {
  image_data_url: string;
  width: number;
  height: number;
  origin: string;
  capture_id: number | null;
  doc: unknown | null;
  project_path: string | null;
}

export interface RecentProject {
  path: string;
  name: string;
  exists: boolean;
}

export async function getEditorSource(): Promise<EditorSource> {
  const d = await invoke<RawEditorSource>("editor_source");
  return {
    imageDataUrl: d.image_data_url,
    width: d.width,
    height: d.height,
    origin: d.origin,
    captureId: d.capture_id,
    doc: d.doc,
    projectPath: d.project_path,
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
export const editorDone = (pngBase64: string): Promise<void> =>
  invoke<void>("editor_done", { pngBase64 });

// ─── Project (.glint) save/load ──────────────────────────────────────────────

const GLINT_FILTER = [{ name: "Glint Project", extensions: ["glint"] }];

/** Native Save dialog → chosen `.glint` path (or null if cancelled). */
export async function pickSavePath(defaultName: string): Promise<string | null> {
  const path = await saveDialog({ filters: GLINT_FILTER, defaultPath: defaultName });
  return path ?? null;
}

/** Native Open dialog → chosen `.glint` path (or null if cancelled). */
export async function pickOpenPath(): Promise<string | null> {
  const path = await openDialog({ filters: GLINT_FILTER, multiple: false, directory: false });
  return typeof path === "string" ? path : null;
}

/** Write the document to a `.glint` at `path`; returns the actual saved path. */
export const saveProject = (doc: unknown, path: string): Promise<string> =>
  invoke<string>("project_save", { doc, path });

/** Open a `.glint`; Rust sets the editor source and shows the editor window. */
export const openProject = (path: string): Promise<void> =>
  invoke<void>("project_open", { path });

// ─── Recent projects (persisted in the plugin-sql `settings` table) ───────────

/** Prepend a path to the recent list (dedup, cap), persisting via settings. */
export async function pushRecentProject(path: string): Promise<void> {
  const list = (await readSetting<string[]>(RECENT_KEY)) ?? [];
  const next = [path, ...list.filter((p) => p !== path)].slice(0, RECENT_CAP);
  await persistSetting(RECENT_KEY, next);
}

/** Read the recent list and resolve each path's basename + on-disk status. */
export async function getRecentProjects(): Promise<RecentProject[]> {
  const list = (await readSetting<string[]>(RECENT_KEY)) ?? [];
  if (list.length === 0) return [];
  return invoke<RecentProject[]>("projects_resolve", { paths: list });
}
