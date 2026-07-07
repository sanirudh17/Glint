import { Group, Rect, Ellipse } from "react-konva";
import type { BoxAnno } from "../../editor/model";

/** One dim overlay for the WHOLE spotlight effect: a full-image dim rect with one
 *  destination-out cut-out per spotlight region. Rendered as the FIRST child of the
 *  annotation group so it dims the screenshot while every annotation stays bright on top.
 *
 *  NO caching (deliberately). The base screenshot lives on a SEPARATE Konva Layer, so
 *  `destination-out` here only erases pixels on THIS layer's canvas — it punches holes in
 *  the dim rect we just drew and can never touch the screenshot beneath. Because the dim
 *  group is the first child, the holes are cut before any annotation is drawn, so
 *  annotations (drawn after) stay fully opaque on top.
 *
 *  We render nothing when there are no spotlights. The layer's normal clear-and-redraw
 *  then shows the screenshot at full brightness. An earlier version cached this group to
 *  "isolate" the composite — but the isolation was already free (separate base layer), and
 *  that cache was precisely what held stale dim pixels when the last region was deleted:
 *  clearCache()/re-cache didn't reliably repaint. Without a cache the layer always
 *  repaints clean, so delete-all reliably returns to normal. */
export function SpotlightDimLayer({
  regions, dim, baseWidth, baseHeight,
}: {
  regions: BoxAnno[];
  dim: number;
  baseWidth: number;
  baseHeight: number;
}) {
  if (regions.length === 0 || baseWidth < 1 || baseHeight < 1) return null;
  return (
    <Group listening={false} x={0} y={0}>
      <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={dim} />
      {regions.map((a) => {
        const x = Math.min(a.x, a.x + a.w);
        const y = Math.min(a.y, a.y + a.h);
        const w = Math.abs(a.w);
        const h = Math.abs(a.h);
        return (a.style.region ?? "rect") === "ellipse" ? (
          <Ellipse
            key={a.id}
            x={x + w / 2} y={y + h / 2}
            radiusX={w / 2} radiusY={h / 2}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        ) : (
          <Rect
            key={a.id}
            x={x} y={y} width={w} height={h}
            fill="#000000"
            globalCompositeOperation="destination-out"
          />
        );
      })}
    </Group>
  );
}
