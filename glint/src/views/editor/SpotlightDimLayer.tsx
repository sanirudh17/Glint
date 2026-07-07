import { useEffect, useRef } from "react";
import { Group, Rect, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { BoxAnno } from "../../editor/model";

/** One dim overlay for the WHOLE spotlight effect. Rendered as the FIRST child of the
 *  annotation group so it dims the screenshot while every annotation stays bright on top.
 *
 *  IMPLEMENTATION (deliberately all source-over — no `destination-out`, no caching):
 *    1. a full-image semi-black rect dims everything, then
 *    2. for each spotlight region we re-paint the ORIGINAL base pixels (a crop of the
 *       screenshot) at full opacity on top, re-brightening exactly that region.
 *
 *  Why not `destination-out` (the previous approach)? Erasing holes with a composite op
 *  left a stale dim on the layer after the last spotlight was deleted — three redraw/cache
 *  fixes couldn't reliably clear it. Every OTHER annotation (plain rects, arrows, solid
 *  redactions) deletes cleanly, and those are all plain source-over draws. So the dim is
 *  now plain source-over too: the layer's normal clear-and-redraw wipes it on delete the
 *  same way it wipes a rectangle. We also keep the Group mounted (empty when there are no
 *  spotlights) and force a batchDraw on change as belt-and-suspenders against react-konva
 *  skipping the redraw on the N→0 transition. */
export function SpotlightDimLayer({
  regions, dim, baseImage, baseWidth, baseHeight,
}: {
  regions: BoxAnno[];
  dim: number;
  baseImage: HTMLImageElement;
  baseWidth: number;
  baseHeight: number;
}) {
  const ref = useRef<Konva.Group>(null);
  const active = regions.length > 0 && baseWidth >= 1 && baseHeight >= 1;
  // Stable signature of the regions so the redraw effect fires on any add/remove/move/
  // resize/shape change — and, crucially, on the N→0 delete-all transition (sig → "").
  const sig = regions.map((a) => `${a.id}:${a.x},${a.y},${a.w},${a.h},${a.style.region ?? "rect"}`).join("|");
  useEffect(() => {
    ref.current?.getLayer()?.batchDraw();
  }, [sig, dim, active]);

  return (
    <Group ref={ref} listening={false} x={0} y={0}>
      {active && (
        <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={dim} />
      )}
      {active &&
        regions.map((a) => {
          // Normalize a possibly-negative drag rect, then clamp to the image so the
          // KonvaImage crop never asks for pixels outside the source (Konva warns).
          const x0 = Math.max(0, Math.min(Math.min(a.x, a.x + a.w), baseWidth));
          const y0 = Math.max(0, Math.min(Math.min(a.y, a.y + a.h), baseHeight));
          const x1 = Math.max(0, Math.min(Math.max(a.x, a.x + a.w), baseWidth));
          const y1 = Math.max(0, Math.min(Math.max(a.y, a.y + a.h), baseHeight));
          const w = x1 - x0;
          const h = y1 - y0;
          if (w < 1 || h < 1) return null;
          const image = (
            <KonvaImage
              image={baseImage}
              x={x0} y={y0} width={w} height={h}
              crop={{ x: x0, y: y0, width: w, height: h }}
              listening={false}
            />
          );
          // Ellipse regions clip the re-painted slice to an ellipse; rect regions paint
          // the slice as-is.
          return (a.style.region ?? "rect") === "ellipse" ? (
            <Group
              key={a.id}
              listening={false}
              clipFunc={(ctx) => {
                ctx.beginPath();
                ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
                ctx.closePath();
              }}
            >
              {image}
            </Group>
          ) : (
            <Group key={a.id} listening={false}>{image}</Group>
          );
        })}
    </Group>
  );
}
