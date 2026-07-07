import { useEffect, useRef } from "react";
import { Group, Rect, Ellipse } from "react-konva";
import type Konva from "konva";
import type { BoxAnno } from "../../editor/model";

/** One dim overlay for the WHOLE spotlight effect: a full-image dim rect with one
 *  destination-out cut-out per spotlight region. Cached so the composite is isolated
 *  to this group's buffer (it must not erase the base image beneath). Rendered at the
 *  bottom of the annotation group, so it dims the screenshot while every annotation
 *  stays bright on top. Renders nothing when there are no spotlights. */
export function SpotlightDimLayer({
  regions, dim, baseWidth, baseHeight,
}: {
  regions: BoxAnno[];
  dim: number;
  baseWidth: number;
  baseHeight: number;
}) {
  const ref = useRef<Konva.Group>(null);
  // Re-cache when geometry / dim / base size changes. `sig` is a stable string of
  // the region rects so a new filtered array each render doesn't thrash the cache.
  const sig = regions.map((a) => `${a.id}:${a.x},${a.y},${a.w},${a.h},${a.style.region ?? "rect"}`).join("|");
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.cache({ x: 0, y: 0, width: baseWidth, height: baseHeight });
    node.getLayer()?.batchDraw();
  }, [sig, dim, baseWidth, baseHeight]);

  if (regions.length === 0) return null;

  return (
    <Group ref={ref} listening={false} x={0} y={0}>
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
