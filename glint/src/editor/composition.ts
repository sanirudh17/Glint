/**
 * composition.ts — pure layout math for the editor's composition (crop + frame).
 *
 * No Konva, no React, no state. Given the base image size, an optional crop, and
 * the layout-relevant frame fields, it computes the framed output geometry in
 * image-native pixels (the "composition" space). Unit-tested in isolation.
 */
export interface Crop { x: number; y: number; w: number; h: number }

export type AspectId = "auto" | "1:1" | "16:9" | "4:3";

/** The frame fields that affect layout (background/colour are irrelevant here). */
export interface FrameLayoutInput {
  enabled: boolean;
  padding: number; // 0–100
  radius: number;
  shadow: number;
  aspect: AspectId;
}

export interface Layout {
  contentW: number; contentH: number;        // cropped screenshot size (native px)
  contentX: number; contentY: number;        // screenshot top-left within the composition
  compositionW: number; compositionH: number; // full framed output size (native px)
  paddingPx: number;                          // resolved padding, per side
  cropX: number; cropY: number;               // crop origin in image space (0,0 when uncropped)
}

const ASPECT_RATIO: Record<AspectId, number | null> = {
  auto: null,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
};

/** Fold a possibly-negative drag rect into a normalized {x,y,w,h} with positive size. */
export function normalizeRect(r: { x: number; y: number; w: number; h: number }): Crop {
  return {
    x: Math.min(r.x, r.x + r.w),
    y: Math.min(r.y, r.y + r.h),
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function computeLayout(
  imageW: number,
  imageH: number,
  crop: Crop | null,
  frame: FrameLayoutInput,
): Layout {
  const cropX = crop ? crop.x : 0;
  const cropY = crop ? crop.y : 0;
  const contentW = crop ? crop.w : imageW;
  const contentH = crop ? crop.h : imageH;

  if (!frame.enabled) {
    return {
      contentW, contentH, contentX: 0, contentY: 0,
      compositionW: contentW, compositionH: contentH,
      paddingPx: 0, cropX, cropY,
    };
  }

  const paddingPx = Math.round((frame.padding / 100) * 0.25 * Math.max(contentW, contentH));
  let compW = contentW + paddingPx * 2;
  let compH = contentH + paddingPx * 2;

  const ratio = ASPECT_RATIO[frame.aspect];
  if (ratio) {
    // Enlarge whichever single axis is deficient so compW/compH === ratio.
    if (compW / compH < ratio) compW = Math.round(compH * ratio);
    else compH = Math.round(compW / ratio);
  }

  return {
    contentW, contentH,
    contentX: Math.round((compW - contentW) / 2),
    contentY: Math.round((compH - contentH) / 2),
    compositionW: compW, compositionH: compH,
    paddingPx, cropX, cropY,
  };
}

/** Pixel ratio that flattens the scaled-down stage back to native composition pixels. */
export function exportPixelRatio(layout: Layout, stageW: number): number {
  return stageW > 0 ? layout.compositionW / stageW : 1;
}
