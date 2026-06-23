import { useEffect, useRef, useState } from "react";
import type { Layout, Crop } from "../../editor/composition";
import { normalizeRect } from "../../editor/composition";

interface Props {
  layout: Layout;
  scale: number;
  imageW: number;
  imageH: number;
  onConfirm: (crop: Crop) => void;
  onCancel: () => void;
}

/** The 8 resize handles as fractions of the crop rect (fx, fy) + a cursor. */
const HANDLES: { id: string; fx: number; fy: number; cursor: string }[] = [
  { id: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { id: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { id: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { id: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { id: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { id: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { id: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { id: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Crop-mode UI: a draggable/resizable rectangle in IMAGE space, drawn over the
 * stage (origin = composition top-left, since the parent wrapper is exactly the
 * stage box). The dim surround is a huge box-shadow on the rect. Enter confirms,
 * Esc cancels. All geometry is clamped to the image bounds.
 */
export function CropOverlay({ layout, scale, imageW, imageH, onConfirm, onCancel }: Props) {
  // Rect in image space; start at the current content bounds.
  const [rect, setRect] = useState<Crop>({
    x: layout.cropX,
    y: layout.cropY,
    w: layout.contentW,
    h: layout.contentH,
  });
  const rectRef = useRef(rect);
  rectRef.current = rect;
  // Hold the confirm/cancel callbacks in a ref so the keydown effect can
  // subscribe once (deps []) without resubscribing when these inline-lambda
  // props change identity on a parent re-render.
  const cbRef = useRef({ onConfirm, onCancel });
  cbRef.current = { onConfirm, onCancel };

  // Smallest crop edge, in image px — clamped down for tiny images so a resize
  // can never produce a crop larger than the image.
  const min = Math.max(1, Math.min(16, Math.floor(imageW / 4), Math.floor(imageH / 4)));

  // The annotation/content offset folded into screen mapping (image → screen px).
  const offX = layout.contentX - layout.cropX;
  const offY = layout.contentY - layout.cropY;
  const L = (offX + rect.x) * scale;
  const T = (offY + rect.y) * scale;
  const W = rect.w * scale;
  const H = rect.h * scale;

  const drag = useRef<null | { mode: string; sx: number; sy: number; orig: Crop }>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Don't hijack Enter/Esc while a panel input (FramePanel slider/color) is focused.
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "Enter") {
        e.preventDefault();
        cbRef.current.onConfirm(normalizeRect(rectRef.current));
      } else if (e.key === "Escape") {
        e.preventDefault();
        cbRef.current.onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const mode = (e.target as HTMLElement).dataset.handle;
    if (!mode) return; // click in the dim surround — ignore
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, orig: rectRef.current };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / scale;
    const dy = (e.clientY - d.sy) / scale;
    const o = d.orig;

    if (d.mode === "move") {
      setRect({
        x: clamp(o.x + dx, 0, imageW - o.w),
        y: clamp(o.y + dy, 0, imageH - o.h),
        w: o.w,
        h: o.h,
      });
      return;
    }

    // Resize: move only the edges named in the handle id, clamped to the image
    // and keeping a minimum size.
    let left = o.x;
    let top = o.y;
    let right = o.x + o.w;
    let bottom = o.y + o.h;
    if (d.mode.includes("w")) left = clamp(o.x + dx, 0, right - min);
    if (d.mode.includes("e")) right = clamp(o.x + o.w + dx, left + min, imageW);
    if (d.mode.includes("n")) top = clamp(o.y + dy, 0, bottom - min);
    if (d.mode.includes("s")) bottom = clamp(o.y + o.h + dy, top + min, imageH);
    setRect({ x: left, y: top, w: right - left, h: bottom - top });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (drag.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      drag.current = null;
    }
  };

  return (
    <div
      className="crop-overlay"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="crop-rect"
        data-handle="move"
        style={{ left: L, top: T, width: W, height: H }}
      >
        {HANDLES.map((h) => (
          <span
            key={h.id}
            className="crop-handle"
            data-handle={h.id}
            style={{ left: `${h.fx * 100}%`, top: `${h.fy * 100}%`, cursor: h.cursor }}
          />
        ))}
      </div>
      <div className="crop-hint">Drag to crop · Enter to apply · Esc to cancel</div>
    </div>
  );
}
