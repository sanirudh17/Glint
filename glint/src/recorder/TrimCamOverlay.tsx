/** TrimCamOverlay.tsx — the movable/resizable circular webcam overlay drawn over the trim
 *  preview. Placement is normalized (0..1 of the video frame); this component measures the
 *  letterboxed video rect inside its box and converts to/from pixels via the pure helpers.
 *  The <video> ref is forwarded so TrimView can slave its time to the main player. */
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type CamPlacement, clampPlacement, videoRectInBox } from "./camOverlay";

type Props = {
  camSrc: string;
  placement: CamPlacement;
  videoAspect: number;
  onChange: (p: CamPlacement) => void;
};

type Drag = { mode: "move" | "resize"; sx: number; sy: number; orig: CamPlacement };

export const TrimCamOverlay = forwardRef<HTMLVideoElement, Props>(function TrimCamOverlay(
  { camSrc, placement, videoAspect, onChange },
  ref,
) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<Drag | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The letterboxed video area (object-fit: contain) inside the box, in px.
  const rect = videoRectInBox(box, videoAspect);
  const left = rect.x + placement.x * rect.w;
  const top = rect.y + placement.y * rect.h;
  const size = placement.diameter * rect.w;

  const onDown = useCallback(
    (mode: "move" | "resize") => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      drag.current = { mode, sx: e.clientX, sy: e.clientY, orig: placement };
    },
    [placement],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || rect.w === 0 || rect.h === 0) return;
      if (d.mode === "move") {
        const dxN = (e.clientX - d.sx) / rect.w;
        const dyN = (e.clientY - d.sy) / rect.h;
        onChange(clampPlacement({ ...d.orig, x: d.orig.x + dxN, y: d.orig.y + dyN }));
      } else {
        // Corner handle: grow on outward (down-right) drag, resize about the centre.
        const dpx = ((e.clientX - d.sx) + (e.clientY - d.sy)) / 2;
        const nd = d.orig.diameter + dpx / rect.w;
        const cx = d.orig.x + d.orig.diameter / 2;
        const cy = d.orig.y + d.orig.diameter / 2;
        onChange(clampPlacement({ ...d.orig, diameter: nd, x: cx - nd / 2, y: cy - nd / 2 }));
      }
    },
    [rect.w, rect.h, onChange],
  );

  const onUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  return (
    <div ref={boxRef} className="trim-cam-layer">
      {placement.visible && rect.w > 0 && (
        <div
          className="trim-cam"
          style={{ left, top, width: size, height: size }}
          onPointerDown={onDown("move")}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <video ref={ref} className="trim-cam-video" src={camSrc} muted playsInline />
          <div
            className="trim-cam-handle"
            onPointerDown={onDown("resize")}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        </div>
      )}
    </div>
  );
});
