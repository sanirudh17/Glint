import type { LookConfig } from "../look/model";
import { hydrateLook } from "../look/model";
import type { Crop } from "../editor/composition";
import type { Clip } from "./trimModel";
import { reserveClipIds } from "./trimModel";
import { validateZooms, type ZoomSegment } from "./studioEffects";
import type { CamPlacement } from "./camOverlay";
export interface CursorConfig {
  visible: boolean; smoothing: number; size: number; style: "arrow" | "dot";
  hideIdle: boolean; idleSeconds: number; clicks: boolean; clickSize: number; keystrokes: boolean;
}
export const DEFAULT_CURSOR: CursorConfig = { visible: true, smoothing: .5, size: 32, style: "arrow", hideIdle: true, idleSeconds: 2, clicks: true, clickSize: 36, keystrokes: false };
export interface StudioProject {
  version: 1 | 2; look: LookConfig; cursor: CursorConfig; crop: Crop | null;
  clips: Clip[]; fadeIn: number; fadeOut: number; cam: CamPlacement | null;
  zoomSegments: ZoomSegment[]; masks: unknown[];
}
export interface InputEvent {
  t: number; kind: "cursor" | "click" | "key"; x?: number; y?: number;
  button?: string; text?: string; down?: boolean; isModifier?: boolean; modifiers?: string[];
}
export interface StudioEvents {
  version: number;
  geometry: { x: number; y: number; width: number; height: number; monitorX: number; monitorY: number; monitorWidth: number; monitorHeight: number; dpiScale: number };
  events: InputEvent[];
}
export interface StudioData { project: StudioProject; events: StudioEvents }
export function hydrateProject(raw: StudioProject, duration: number): StudioProject {
  if (raw.version !== 1 && raw.version !== 2) throw new Error("This Studio project needs a newer Glint version.");
  if (!Array.isArray(raw.clips) || !raw.clips.length || raw.clips.some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration + .05 || c.end <= c.start || c.speed < .5 || c.speed > 2)) throw new Error("The Studio timeline is invalid.");
  reserveClipIds(raw.clips);
  if (!validateZooms(raw.zoomSegments ?? [], duration)) throw new Error("The Studio zoom settings are invalid.");
  return { ...raw, version: 2, look: hydrateLook(raw.look), cursor: { ...DEFAULT_CURSOR, ...raw.cursor }, crop: raw.crop ?? null, cam: raw.cam ?? null, fadeIn: raw.fadeIn ?? 0, fadeOut: raw.fadeOut ?? 0, zoomSegments: raw.zoomSegments ?? [], masks: raw.masks ?? [] };
}
/** Map the rendered timeline back to the untouched source, respecting reorder/speed. */
export function sourceTimeAt(clips: Clip[], outputTime: number): number {
  let elapsed = 0;
  const kept = clips.filter((c) => c.kept).sort((a, b) => a.order - b.order);
  for (const clip of kept) {
    const d = (clip.end - clip.start) / clip.speed;
    if (outputTime < elapsed + d) return clip.start + Math.max(0, outputTime - elapsed) * clip.speed;
    elapsed += d;
  }
  return kept[kept.length - 1]?.end ?? 0;
}
