/** Keep a right-aligned action popup inside the viewport, even after row wrapping. */
export function popoverPlacement(anchor: { left?: number; right: number; top: number; bottom: number }, viewport: { width: number; height: number }) {
  const margin = 8;
  const gap = 6;
  const width = Math.max(0, Math.min(288, viewport.width - margin * 2));
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const up = below < 180 && above > below;
  const start = anchor.left !== undefined && anchor.left < viewport.width / 2
    ? anchor.left : anchor.right - width;
  return {
    width,
    left: Math.max(margin, Math.min(start, viewport.width - width - margin)),
    top: up ? undefined : anchor.bottom + gap,
    bottom: up ? viewport.height - anchor.top + gap : undefined,
    maxHeight: up ? above : below,
  };
}
