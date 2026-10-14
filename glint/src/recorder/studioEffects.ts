import type { Crop } from "../editor/composition";

export type ZoomEase = "gentle" | "snappy" | "slow";
export interface ZoomSegment {
  id: string; start: number; end: number; scale: number;
  mode: "fixed" | "follow-cursor"; focus: { x: number; y: number };
  ease: ZoomEase; easeIn: number; easeOut: number;
  origin: "manual" | "auto" | "marker"; edited: boolean;
  transitionStart?: number; transitionEnd?: number;
  followOffset?: {x:number;y:number};
}
export const effectId = () => crypto.randomUUID();
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export function newZoom(time: number, duration: number): ZoomSegment {
  const start = clamp(time, 0, Math.max(0, duration - .1));
  return { id: effectId(), start, end: Math.min(duration, start + 2), scale: 2, mode: "fixed", focus: { x: .5, y: .5 }, ease: "gentle", easeIn: .4, easeOut: .4, origin: "manual", edited: true };
}
export function easeValue(t: number, ease: ZoomEase): number {
  const x = clamp(t, 0, 1);
  return ease === "snappy" ? 1 - (1 - x) ** 3 : ease === "slow" ? (1 - Math.cos(Math.PI * x)) / 2 : x * x * (3 - 2 * x);
}
export function zoomAt(segments: ZoomSegment[], t: number, crop: Crop, sourceW: number, sourceH: number, cursor?: { x: number; y: number;latestX?:number;latestY?:number } | null) {
  const active = segments.filter(s => s.start <= t && t < s.end).sort((a, b) => (Number(a.origin === "manual" || a.edited) - Number(b.origin === "manual" || b.edited)) || a.start - b.start);
  const segment = active[active.length - 1];
  if (!segment) return { ...crop, scale: 1 };
  const start = segment.transitionStart ?? segment.start, end = segment.transitionEnd ?? segment.end;
  const into = segment.easeIn > 0 ? easeValue((t - start) / segment.easeIn, segment.ease) : 1;
  const out = segment.easeOut > 0 ? easeValue((end - t) / segment.easeOut, segment.ease) : 1;
  const scale = 1 + (segment.scale - 1) * Math.min(into, out);
  const w = crop.w / scale, h = crop.h / scale;
  const focus = segment.mode === "follow-cursor" && cursor ? {x:cursor.x+(segment.followOffset?.x??0)*sourceW,y:cursor.y+(segment.followOffset?.y??0)*sourceH} : { x: segment.focus.x * sourceW, y: segment.focus.y * sourceH };
  let x=clamp(focus.x-w/2,crop.x,crop.x+crop.w-w),y=clamp(focus.y-h/2,crop.y,crop.y+crop.h-h);
  if(segment.mode==='follow-cursor'&&cursor?.latestX!==undefined&&cursor.latestY!==undefined) {
    x=clamp(clamp(x,cursor.latestX-w*.9,cursor.latestX-w*.1),crop.x,crop.x+crop.w-w);
    y=clamp(clamp(y,cursor.latestY-h*.9,cursor.latestY-h*.1),crop.y,crop.y+crop.h-h);
  }
  return {x,y,w,h,scale};
}
export function splitZoom(segment: ZoomSegment, time: number): ZoomSegment[] {
  if (time <= segment.start + .05 || time >= segment.end - .05) return [segment];
  const transitions = { transitionStart: segment.transitionStart ?? segment.start, transitionEnd: segment.transitionEnd ?? segment.end, edited: true };
  return [{ ...segment, ...transitions, end: time }, { ...segment, ...transitions, id: effectId(), start: time }];
}
export function validateZooms(segments: ZoomSegment[], duration: number): boolean {
  return segments.length <= 512 && new Set(segments.map(s => s.id)).size === segments.length && segments.every(s =>
    typeof s.id === "string" && [s.start,s.end,s.scale,s.focus?.x,s.focus?.y,s.easeIn,s.easeOut].every(Number.isFinite)
    && s.start >= 0 && s.end > s.start && s.end <= duration + .05 && s.scale >= 1.2 && s.scale <= 3
    && s.focus.x >= 0 && s.focus.x <= 1 && s.focus.y >= 0 && s.focus.y <= 1
    && s.easeIn >= 0 && s.easeIn <= 2 && s.easeOut >= 0 && s.easeOut <= 2
    && ["gentle","snappy","slow"].includes(s.ease) && ["fixed","follow-cursor"].includes(s.mode)
    && ["manual","auto","marker"].includes(s.origin)
    && (s.followOffset===undefined||[s.followOffset.x,s.followOffset.y].every(v=>Number.isFinite(v)&&v>=-1&&v<=1))
    && (s.transitionStart === undefined || Number.isFinite(s.transitionStart) && s.transitionStart <= s.start)
    && (s.transitionEnd === undefined || Number.isFinite(s.transitionEnd) && s.transitionEnd >= s.end));
}
