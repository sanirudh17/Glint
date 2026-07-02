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
  /** Only the layout-relevant chrome field; theme/title/url are visual-only. Optional so
      existing callers and legacy layouts default to no chrome. */
  chrome?: { style: "none" | "window" | "browser" };
}

export interface Layout {
  contentW: number; contentH: number;        // cropped screenshot size (native px)
  contentX: number; contentY: number;        // screenshot top-left within the composition
  compositionW: number; compositionH: number; // full framed output size (native px)
  paddingPx: number;                          // resolved padding, per side
  cropX: number; cropY: number;               // crop origin in image space (0,0 when uncropped)
  chromeH: number;                            // height of the chrome band above the image (0 when none)
}

const ASPECT_RATIO: Record<AspectId, number | null> = {
  auto: null,
  "1:1": 1,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
};

// Chrome bar height scales with the screenshot's width so it reads consistently
// across capture sizes, then clamps (tuned at-screen, like the shadow ramp).
const BAR_RATIO = 0.045;
const BAR_MIN = 28;
const BAR_MAX = 120;

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
      paddingPx: 0, cropX, cropY, chromeH: 0,
    };
  }

  const chromeStyle = frame.chrome?.style ?? "none";
  const barH = Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(contentW * BAR_RATIO)));
  const chromeH = chromeStyle === "none" ? 0 : barH;

  const paddingPx = Math.round((frame.padding / 100) * 0.25 * Math.max(contentW, contentH));
  let compW = contentW + paddingPx * 2;
  let compH = contentH + chromeH + paddingPx * 2;

  const ratio = ASPECT_RATIO[frame.aspect];
  if (ratio) {
    // Enlarge whichever single axis is deficient so compW/compH === ratio.
    if (compW / compH < ratio) compW = Math.round(compH * ratio);
    else compH = Math.round(compW / ratio);
  }

  // The card (chrome bar + image) is centered vertically; the image sits chromeH
  // below the card's top. With chromeH 0 this reduces to the pre-chrome math.
  const cardTop = Math.round((compH - (chromeH + contentH)) / 2);

  return {
    contentW, contentH,
    contentX: Math.round((compW - contentW) / 2),
    contentY: cardTop + chromeH,
    compositionW: compW, compositionH: compH,
    paddingPx, cropX, cropY, chromeH,
  };
}

/** Pixel ratio that flattens the scaled-down stage back to native composition pixels. */
export function exportPixelRatio(layout: Layout, stageW: number): number {
  return stageW > 0 ? layout.compositionW / stageW : 1;
}
