import {validateAnnotations,type VideoAnnotation} from "./videoAnnotations";
import type { LookConfig } from "../look/model";
import { hydrateLook } from "../look/model";
import type { Crop } from "../editor/composition";
import type { Clip } from "./trimModel";
import { reserveClipIds } from "./trimModel";
import { validateZooms, type ZoomSegment } from "./studioEffects";
import { importZoomMarkers } from "./studioMarkers";
import { validateMasks,type MaskSegment } from "./studioMasks";
import type {MotionBlur} from './studioMotion';
import type { CamPlacement } from "./camOverlay";
import type {AudioCleanup,Caption,Entrance} from './studioPolish';
export interface CursorConfig {
  visible: boolean; smoothing: number; size: number; style: "arrow" | "dot";
  spotlight?:boolean; recordedEffects?:boolean;
  hideIdle: boolean; idleSeconds: number; clicks: boolean; clickSize: number; keystrokes: boolean;
}
export const DEFAULT_CURSOR: CursorConfig = { visible: true, smoothing: .5, size: 32, style: "arrow", hideIdle: true, idleSeconds: 2, clicks: true, clickSize: 36, keystrokes: false,spotlight:false,recordedEffects:true };
export interface StudioProject {
  version: 1 | 2; look: LookConfig; cursor: CursorConfig; crop: Crop | null;
  clips: Clip[]; fadeIn: number; fadeOut: number; cam: CamPlacement | null;
  zoomSegments: ZoomSegment[]; masks: MaskSegment[];
  importedMarkers?:string[];
  importedVideo?:boolean;
  deleteSourceAfterExport?:boolean;
  motionBlur?:MotionBlur;
  audioCleanup?:AudioCleanup;
  captions?:Caption[];
  annotations?:VideoAnnotation[];
  captionsEnabled?:boolean;
  contentMotion?:Entrance;
  contentMotionSeconds?:number;
}
export interface InputEvent {
  t: number; kind: "cursor" | "click" | "key" | "marker" | "effects"; x?: number; y?: number;
  clicks?:boolean;keystrokes?:boolean;spotlight?:boolean;
  button?: string; text?: string; down?: boolean; isModifier?: boolean; modifiers?: string[];
}
export interface StudioEvents {
  version: number;
  geometry: { x: number; y: number; width: number; height: number; monitorX: number; monitorY: number; monitorWidth: number; monitorHeight: number; dpiScale: number };
  events: InputEvent[];
}
export interface StudioData { project: StudioProject; events: StudioEvents }
export function hydrateProject(raw: StudioProject, duration: number, events?:StudioEvents, size?:{width:number;height:number}): StudioProject {
  if (raw.version !== 1 && raw.version !== 2) throw new Error("This Studio project needs a newer Glint version.");
  if (!Array.isArray(raw.clips) || !raw.clips.length || raw.clips.some((c) => !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end > duration + .05 || c.end <= c.start || c.speed < .5 || c.speed > 2)) throw new Error("The Studio timeline is invalid.");
  reserveClipIds(raw.clips);
  if(!validateAnnotations(raw.annotations??[],duration))throw new Error("The video annotations are invalid.");
  if (!validateZooms(raw.zoomSegments ?? [], duration)) throw new Error("The Studio zoom settings are invalid.");
  if(!validateMasks(raw.masks??[],duration,size?.width,size?.height))throw new Error('The Studio masks are invalid.');
  if(raw.motionBlur&&(typeof raw.motionBlur.enabled!=='boolean'||!Number.isFinite(raw.motionBlur.intensity)||raw.motionBlur.intensity<0||raw.motionBlur.intensity>1))throw new Error('The motion blur settings are invalid.');
  const project:StudioProject={ ...raw, version: 2, look: hydrateLook(raw.look), cursor: { ...DEFAULT_CURSOR, ...raw.cursor }, crop: raw.crop ?? null, cam: raw.cam ?? null, fadeIn: raw.fadeIn ?? 0, fadeOut: raw.fadeOut ?? 0, zoomSegments: raw.zoomSegments ?? [], masks: raw.masks ?? [] };
  return events ? {...project,...importZoomMarkers(project.zoomSegments,project.importedMarkers??[],events,duration)} : project;
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
