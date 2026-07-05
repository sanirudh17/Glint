/** camOverlay.ts — pure geometry for the trim-editor webcam overlay. Placement is stored
 *  normalized (0..1) to the video frame so it's resolution-independent and maps cleanly to
 *  source pixels at export. `x,y` are the bubble's top-left corner. */
export type CamPlacement = { x: number; y: number; diameter: number; visible: boolean };

export const MIN_D = 0.06;
export const MAX_D = 0.6;
const MARGIN = 0.03;

export const DEFAULT_PLACEMENT: CamPlacement = {
  diameter: 0.18,
  x: 1 - 0.18 - MARGIN,
  y: 1 - 0.18 - MARGIN,
  visible: true,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Clamp diameter to [MIN_D, MAX_D], then keep the bubble fully inside the frame. */
export function clampPlacement(p: CamPlacement): CamPlacement {
  const diameter = clamp(p.diameter, MIN_D, MAX_D);
  return {
    diameter,
    x: clamp(p.x, 0, 1 - diameter),
    y: clamp(p.y, 0, 1 - diameter),
    visible: p.visible,
  };
}

/** The letterboxed (object-fit: contain) video rect inside a container of size `box`. */
export function videoRectInBox(box: { w: number; h: number }, videoAspect: number) {
  const boxAspect = box.w / box.h;
  if (videoAspect > boxAspect) {
    const w = box.w;
    const h = box.w / videoAspect;
    return { x: 0, y: (box.h - h) / 2, w, h };
  }
  const h = box.h;
  const w = box.h * videoAspect;
  return { x: (box.w - w) / 2, y: 0, w, h };
}

/** Normalized placement → source pixels (rounded to even for yuv420 safety). */
export function toPixels(p: CamPlacement, srcW: number, srcH: number) {
  const even = (n: number) => Math.round(n / 2) * 2;
  return { x: even(p.x * srcW), y: even(p.y * srcH), d: even(p.diameter * srcW) };
}
