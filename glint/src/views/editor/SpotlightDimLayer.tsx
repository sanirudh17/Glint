import { useEffect, useRef } from "react";
import { Group, Rect, Ellipse } from "react-konva";
import type Konva from "konva";
import type { BoxAnno } from "../../editor/model";

/** One dim overlay for the WHOLE spotlight effect: a full-image dim rect with one
 *  destination-out cut-out per spotlight region. Cached so the composite is isolated
 *  to this group's buffer (it must not erase the base image beneath). Rendered at the
 *  bottom of the annotation group, so it dims the screenshot while every annotation
 *  stays bright on top.
 *
 *  The group is ALWAYS mounted with the full-canvas dim Rect present; its opacity is
 *  driven to 0 when there are no spotlights. We re-`cache()` on every change (never
 *  rely on unmount/clearCache) so the cached buffer is regenerated from scratch —
 *  deleting the last spotlight regenerates a fully-transparent buffer, so the dim
 *  actually disappears (returning null / clearCache left stale pixels on the layer). */
export function SpotlightDimLayer({
  regions, dim, baseWidth, baseHeight,
}: {
  regions: BoxAnno[];
  dim: number;
  baseWidth: number;
  baseHeight: number;
}) {
  const ref = useRef<Konva.Group>(null);
  const active = regions.length > 0;
  // `sig` is a stable string of the region rects so a new filtered array each render
  // doesn't thrash the cache; empty → "" so the N→0 transition re-caches.
  const sig = regions.map((a) => `${a.id}:${a.x},${a.y},${a.w},${a.h},${a.style.region ?? "rect"}`).join("|");
  useEffect(() => {
    const node = ref.current;
    if (!node || baseWidth < 1 || baseHeight < 1) return;
    node.cache({ x: 0, y: 0, width: baseWidth, height: baseHeight });
    node.getLayer()?.batchDraw();
  }, [sig, dim, baseWidth, baseHeight]);

  return (
    <Group ref={ref} listening={false} x={0} y={0}>
      {/* Full-canvas dim, transparent when there are no spotlights (so an empty set
          renders — and re-caches — to nothing rather than leaving stale pixels). */}
      <Rect x={0} y={0} width={baseWidth} height={baseHeight} fill="#000000" opacity={active ? dim : 0} />
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
