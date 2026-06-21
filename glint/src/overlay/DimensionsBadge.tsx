/**
 * DimensionsBadge.tsx — Live physical-pixel dimensions for the selection rect.
 *
 * Shows `W × H` in PHYSICAL pixels (logical dimensions × device pixel ratio / scale).
 * This matches what the saved image will actually be — the rect itself stays logical
 * for commitCapture, only the badge display is scaled.
 *
 * Positioning: anchored outside the bottom-right corner of the selection by default.
 * Edge-flip logic keeps it on screen:
 *   - If the selection's right edge is within BADGE_W + MARGIN of the viewport right,
 *     flip to position badge to the left of the selection's right edge.
 *   - If the selection's bottom edge is within BADGE_H + MARGIN of the viewport bottom,
 *     flip badge above the selection.
 *
 * Design: "ink on glass" — monospace text, 1px accent border, slightly elevated
 * background. No glow. No shadow. Crisp and subordinate.
 */

import type { Rect } from "./modes";

// Estimated badge dimensions for edge-flip decisions.
// These are approximations; the badge is sized by content via CSS.
const BADGE_W = 90; // px (logical)
const BADGE_H = 22; // px (logical)
const MARGIN = 8;   // gap between selection edge and badge

interface DimensionsBadgeProps {
  rect: Rect;
  /** Device pixel ratio / monitor scale factor — multiply logical rect to get physical px. */
  scale: number;
}

export function DimensionsBadge({ rect, scale }: DimensionsBadgeProps) {
  const { x, y, w, h } = rect;

  // Don't render for trivial selections
  if (w < 2 || h < 2) return null;

  const physW = Math.round(w * scale);
  const physH = Math.round(h * scale);

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Determine horizontal flip: default → right of selection right edge
  const rightEdge = x + w;
  const flipH = rightEdge + MARGIN + BADGE_W > vw;

  // Determine vertical flip: default → below selection bottom edge
  const bottomEdge = y + h;
  const flipV = bottomEdge + MARGIN + BADGE_H > vh;

  const style: React.CSSProperties = {
    position: "fixed",
  };

  if (flipH) {
    // Badge right edge aligns with the selection right edge
    style.left = rightEdge - BADGE_W;
  } else {
    // Badge left edge just outside selection right edge
    style.left = rightEdge + MARGIN;
  }

  if (flipV) {
    // Badge sits just above the selection top edge
    style.top = y - BADGE_H - MARGIN;
  } else {
    // Badge sits just below the selection bottom edge
    style.top = bottomEdge + MARGIN;
  }

  return (
    <div className="sl-dimensions-badge" style={style} aria-live="polite" aria-atomic>
      <span className="sl-dimensions-text">
        {physW}<span className="sl-dimensions-sep">×</span>{physH}
      </span>
    </div>
  );
}
