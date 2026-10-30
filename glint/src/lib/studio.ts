import { invoke } from "@tauri-apps/api/core";
import type { StudioData, StudioProject } from "../recorder/studioModel";
export const studioLoad = (path: string) => invoke<StudioData | null>("studio_load", { path });
export const studioImport = (path: string) => invoke<StudioData>("studio_import", { path });
export const studioSave = (path: string, project: StudioProject) => invoke<void>("studio_save", { path, project });

export const studioExport = (path: string, project: StudioProject) => invoke<string>("studio_export", { path, project });
export const studioExportCancel = () => invoke<void>("studio_export_cancel");
export const studioDiscardSource = (path:string,exportPath:string) => invoke<void>('studio_discard_source',{path,exportPath});
