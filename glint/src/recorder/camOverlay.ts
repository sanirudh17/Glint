/** camOverlay.ts — pure geometry for the trim-editor webcam overlay. Placement is stored
 *  normalized (0..1) to the video frame. `diameter` is the box WIDTH as a fraction of the
 *  video width; the box HEIGHT follows the shape's aspect. `x,y` are the top-left corner. */
export type CamShape = "circle" | "rounded" | "square" | "rect";
export type CamPlacement = { x: number; y: number; diameter: number; visible: boolean; shape: CamShape };

export const MIN_D = 0.06;
export const MAX_D = 0.6;
const MARGIN = 0.03;

export const DEFAULT_PLACEMENT: CamPlacement = {
  diameter: 0.18,
  x: 1 - 0.18 - MARGIN,
  y: 1 - 0.18 - MARGIN,
  visible: true,
  shape: "circle",
};

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The box width:height aspect for a shape. Circle/square are 1:1; rounded/rect follow the
 *  camera's native aspect so the picture isn't distorted. */
export function shapeAspect(shape: CamShape, videoAspect: number): number {
  return shape === "circle" || shape === "square" ? 1 : videoAspect;
}

/** Clamp diameter (box width) to [MIN_D, MAX_D], then keep the box fully inside the frame.
 *  Height is derived from the shape aspect at render/export time, so clamping uses width. */
export function clampPlacement(p: CamPlacement): CamPlacement {
  const diameter = clamp(p.diameter, MIN_D, MAX_D);
  return {
    diameter,
    x: clamp(p.x, 0, 1 - diameter),
    y: clamp(p.y, 0, 1 - diameter),
    visible: p.visible,
    shape: p.shape,
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

/** Normalized placement → source pixels (even for yuv420 safety). Width from `diameter`;
 *  height from the shape aspect. */
export function toPixels(p: CamPlacement, srcW: number, srcH: number, videoAspect: number) {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const w = even(p.diameter * srcW);
  const h = even(w / shapeAspect(p.shape, videoAspect));
  return { x: even(p.x * srcW), y: even(p.y * srcH), w, h };
}
