/**
 * gradients.ts — curated background gradient presets (local-first; no assets).
 * Each preset is a list of color stops + an angle; konvaGradient() turns it into
 * react-konva linear-gradient props sized to a w×h rect.
 */
export interface GradientStop { offset: number; color: string }
export interface GradientPreset { id: string; label: string; stops: GradientStop[]; angleDeg: number }

export const GRADIENTS: GradientPreset[] = [
  { id: "dusk",    label: "Dusk",    angleDeg: 135, stops: [{ offset: 0, color: "#5B7CFA" }, { offset: 1, color: "#9D6CFF" }] },
  { id: "sunset",  label: "Sunset",  angleDeg: 135, stops: [{ offset: 0, color: "#FF7E5F" }, { offset: 1, color: "#FEB47B" }] },
  { id: "ocean",   label: "Ocean",   angleDeg: 135, stops: [{ offset: 0, color: "#2E3192" }, { offset: 1, color: "#1BFFFF" }] },
  { id: "forest",  label: "Forest",  angleDeg: 135, stops: [{ offset: 0, color: "#11998E" }, { offset: 1, color: "#38EF7D" }] },
  { id: "ember",   label: "Ember",   angleDeg: 135, stops: [{ offset: 0, color: "#F12711" }, { offset: 1, color: "#F5AF19" }] },
  { id: "slate",   label: "Slate",   angleDeg: 135, stops: [{ offset: 0, color: "#232526" }, { offset: 1, color: "#414345" }] },
  { id: "rose",    label: "Rose",    angleDeg: 135, stops: [{ offset: 0, color: "#ED4264" }, { offset: 1, color: "#FFEDBC" }] },
  { id: "mint",    label: "Mint",    angleDeg: 135, stops: [{ offset: 0, color: "#43C6AC" }, { offset: 1, color: "#F8FFAE" }] },
  { id: "grape",   label: "Grape",   angleDeg: 135, stops: [{ offset: 0, color: "#7F00FF" }, { offset: 1, color: "#E100FF" }] },
  { id: "sky",     label: "Sky",     angleDeg: 135, stops: [{ offset: 0, color: "#56CCF2" }, { offset: 1, color: "#2F80ED" }] },
  { id: "coral",   label: "Coral",   angleDeg: 135, stops: [{ offset: 0, color: "#FF512F" }, { offset: 1, color: "#DD2476" }] },
  { id: "gold",    label: "Gold",    angleDeg: 135, stops: [{ offset: 0, color: "#F7971E" }, { offset: 1, color: "#FFD200" }] },
  { id: "aurora",  label: "Aurora",  angleDeg: 135, stops: [{ offset: 0, color: "#00C9FF" }, { offset: 1, color: "#92FE9D" }] },
  { id: "lavender",label: "Lavender",angleDeg: 135, stops: [{ offset: 0, color: "#C9D6FF" }, { offset: 1, color: "#E2E2E2" }] },
  { id: "midnight",label: "Midnight",angleDeg: 135, stops: [{ offset: 0, color: "#0F2027" }, { offset: 1, color: "#2C5364" }] },
  { id: "steel",   label: "Steel",   angleDeg: 135, stops: [{ offset: 0, color: "#BDC3C7" }, { offset: 1, color: "#2C3E50" }] },
];

export function getGradient(id: string): GradientPreset {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[0];
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
