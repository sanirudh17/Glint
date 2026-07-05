/** TrimFilmstrip.tsx — reorderable strip of kept clips (playback order) for the trim editor.
 *  Recorder-owned; drags with pointer events (WebView2-safe) + elementFromPoint hit-testing. */
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { keptClipsInOrder, type Clip } from "./trimModel";

const secs = (start: number, end: number, speed: number) => `${((end - start) / speed).toFixed(1)}s`;

export function TrimFilmstrip({
  clips,
  disabled,
  onReorder,
}: {
  clips: Clip[];
  disabled: boolean;
  onReorder: (from: number, to: number) => void;
}) {
  const ordered = keptClipsInOrder(clips);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  // Fewer than 2 kept clips → nothing to reorder.
  if (ordered.length < 2) return null;

  // Map a client-x/y to the tile index under it (via the tile's data-strip-index attribute).
  const indexAt = (clientX: number, clientY: number): number | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const tile = el?.closest<HTMLElement>("[data-strip-index]");
    if (!tile) return null;
    const n = Number(tile.dataset.stripIndex);
    return Number.isFinite(n) ? n : null;
  };

  const onPointerDown = (e: React.PointerEvent, i: number) => {
    if (disabled) return;
    e.preventDefault();
    setDragFrom(i);
    setOverIndex(i);
    const move = (ev: PointerEvent) => {
      const idx = indexAt(ev.clientX, ev.clientY);
      if (idx != null) setOverIndex(idx);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const to = indexAt(ev.clientX, ev.clientY);
      setDragFrom(null);
      setOverIndex(null);
      if (to != null && to !== i) onReorder(i, to);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div className="trim-filmstrip" ref={rowRef} role="listbox" aria-label="Clip order">
      {ordered.map((c, i) => (
        <div
          key={c.id}
          data-strip-index={i}
          className={
            "trim-strip-tile" +
            (dragFrom === i ? " trim-strip-tile--dragging" : "") +
            (overIndex === i && dragFrom !== null && dragFrom !== i ? " trim-strip-tile--over" : "")
          }
          onPointerDown={(e) => onPointerDown(e, i)}
          title="Drag to reorder"
        >
          <GripVertical size={13} className="trim-strip-grip" />
          <span className="trim-strip-index">{i + 1}</span>
          <span className="trim-strip-dur">{secs(c.start, c.end, c.speed)}</span>
          {c.speed !== 1 && <span className="trim-strip-speed">{c.speed}×</span>}
        </div>
      ))}
    </div>
  );
}
