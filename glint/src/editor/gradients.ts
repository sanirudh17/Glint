import presets from "../look/gradients.json";
/**
 * gradients.ts — curated background gradient presets (local-first; no assets).
 * Each preset is a list of color stops + an angle; konvaGradient() turns it into
 * react-konva linear-gradient props sized to a w×h rect.
 */
export interface GradientStop { offset: number; color: string }
export interface GradientPreset { id: string; label: string; stops: GradientStop[]; angleDeg: number }

export const GRADIENTS: GradientPreset[] = presets;

export function getGradient(id: string): GradientPreset {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[0];
}

/** CSS measures clockwise from up; the canvas measures clockwise from right. */
export function cssGradient(preset: GradientPreset): string {
  return `linear-gradient(${preset.angleDeg + 90}deg, ${preset.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(", ")})`;
}

export function konvaGradient(preset: GradientPreset, w: number, h: number): {
  fillLinearGradientStartPoint: { x: number; y: number };
  fillLinearGradientEndPoint: { x: number; y: number };
  fillLinearGradientColorStops: (number | string)[];
} {
  const rad = (preset.angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  // Span the gradient across the rect's projection onto the angle direction.
  const len = Math.abs(dx) * w + Math.abs(dy) * h;
  return {
    fillLinearGradientStartPoint: { x: cx - (dx * len) / 2, y: cy - (dy * len) / 2 },
    fillLinearGradientEndPoint: { x: cx + (dx * len) / 2, y: cy + (dy * len) / 2 },
    fillLinearGradientColorStops: preset.stops.flatMap((s) => [s.offset, s.color]),
  };
}
