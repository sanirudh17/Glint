/** TrimFilmstrip.tsx — reorderable strip of kept clips (playback order) for the trim editor.
 *  Recorder-owned. Drag reorders; a click (no drag) selects the clip in the timeline. Uses
 *  pointer CAPTURE + geometry hit-testing (WebView2-safe: capture guarantees we keep the
 *  move/up stream even as the cursor leaves the tile, and geometry never "misses" a target). */
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { keptClipsInOrder, type Clip } from "./trimModel";

const secs = (start: number, end: number, speed: number) => `${((end - start) / speed).toFixed(1)}s`;
/** Below this many px of movement a press is a click (select), not a drag (reorder). */
const DRAG_SLOP = 4;

export function TrimFilmstrip({
  clips,
  disabled,
  selectedId,
  onReorder,
  onSelect,
}: {
  clips: Clip[];
  disabled: boolean;
  selectedId: number | null;
  onReorder: (from: number, to: number) => void;
  onSelect: (id: number) => void;
}) {
  const ordered = keptClipsInOrder(clips);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef<DOMRect[]>([]); // tile rects snapshotted at drag start
  const startXRef = useRef(0);
  const movedRef = useRef(false);

  // Fewer than 2 kept clips → nothing to reorder.
  if (ordered.length < 2) return null;

  // Target index for a pointer x: the first tile whose horizontal midpoint the cursor hasn't
  // passed (i.e. where the dragged tile would land), clamped to the last tile.
  const tileIndexAtX = (clientX: number): number => {
    const rects = rectsRef.current;
    for (let k = 0; k < rects.length; k++) {
      if (clientX < rects[k].left + rects[k].width / 2) return k;
    }
    return Math.max(0, rects.length - 1);
  };

  const onPointerDown = (e: React.PointerEvent, i: number) => {
    if (disabled) return;
    e.preventDefault();
    // Capture so every move/up lands here even as the cursor moves over sibling tiles.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    rectsRef.current = Array.from(
      rowRef.current?.querySelectorAll<HTMLElement>("[data-strip-index]") ?? [],
    ).map((el) => el.getBoundingClientRect());
    startXRef.current = e.clientX;
    movedRef.current = false;
    setDragFrom(i);
    setOverIndex(i);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragFrom === null) return;
    if (Math.abs(e.clientX - startXRef.current) > DRAG_SLOP) movedRef.current = true;
    setOverIndex(tileIndexAtX(e.clientX));
  };

  const onPointerUp = (e: React.PointerEvent, i: number) => {
    if (dragFrom === null) return;
    const to = tileIndexAtX(e.clientX);
    const moved = movedRef.current;
    setDragFrom(null);
    setOverIndex(null);
    if (!moved) onSelect(ordered[i].id);   // a click seats the timeline selection
    else if (to !== i) onReorder(i, to);   // a drag reorders
  };

  return (
    <div className="trim-filmstrip" ref={rowRef} role="listbox" aria-label="Clip order">
      {ordered.map((c, i) => (
        <div
          key={c.id}
          data-strip-index={i}
          className={
            "trim-strip-tile" +
            (c.id === selectedId ? " trim-strip-tile--selected" : "") +
            (dragFrom === i ? " trim-strip-tile--dragging" : "") +
            (overIndex === i && dragFrom !== null && dragFrom !== i ? " trim-strip-tile--over" : "")
          }
          onPointerDown={(e) => onPointerDown(e, i)}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerUp(e, i)}
          title="Drag to reorder · click to select"
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
