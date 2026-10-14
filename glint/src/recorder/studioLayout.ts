import { computeLayout, type Crop } from "../editor/composition";
import type { LookConfig } from "../look/model";
export function clampCrop(crop: Crop | null, width: number, height: number): Crop | null {
  if (!crop) return null;
  const x = Math.round(Math.max(0, Math.min(width - 2, crop.x)));
  const y = Math.round(Math.max(0, Math.min(height - 2, crop.y)));
  return { x, y, w: Math.round(Math.max(2, Math.min(width - x, crop.w))), h: Math.round(Math.max(2, Math.min(height - y, crop.h))) };
}
export function studioLayout(width: number, height: number, crop: Crop | null, look: LookConfig, maxEdge = 1920) {
  const layout = computeLayout(width, height, clampCrop(crop, width, height), look);
  const scale = Math.min(1, maxEdge / Math.max(layout.compositionW, layout.compositionH));
  const w = Math.max(2, Math.round(layout.compositionW * scale / 2) * 2);
  const h = Math.max(2, Math.round(layout.compositionH * scale / 2) * 2);
  return { layout, scale, width: w, height: h };
}
