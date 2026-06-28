/** RegionSelect.tsx — live (non-frozen) drag-to-pick record region (#/rec-select). */
import { useRef, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { recorderStartRegion } from "../lib/recorder";
import "./recorder.css";

type Pt = { x: number; y: number };

export function RegionSelect() {
  const [start, setStart] = useState<Pt | null>(null);
  const [cur, setCur] = useState<Pt | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") getCurrentWindow().close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const rect = start && cur
    ? { left: Math.min(start.x, cur.x), top: Math.min(start.y, cur.y),
        w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) }
    : null;

  const onDown = (e: React.PointerEvent) => { dragging.current = true; setStart({ x: e.clientX, y: e.clientY }); setCur({ x: e.clientX, y: e.clientY }); };
  const onMove = (e: React.PointerEvent) => { if (dragging.current) setCur({ x: e.clientX, y: e.clientY }); };
  const onUp = async () => {
    dragging.current = false;
    if (!rect || rect.w < 8 || rect.h < 8) { getCurrentWindow().close(); return; }
    const scale = await getCurrentWindow().scaleFactor();
    const mon = (await getCurrentWindow().outerPosition()); // window covers the monitor at its origin
    // CSS px → physical px, offset by the monitor's physical origin.
    const x = Math.round(mon.x + rect.left * scale);
    const y = Math.round(mon.y + rect.top * scale);
    const w = Math.round(rect.w * scale);
    const h = Math.round(rect.h * scale);
    await getCurrentWindow().close();
    await recorderStartRegion({ x, y, w, h });
  };

  return (
    <div className="rec-select" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
      {rect && (
        <div className="rec-select-rect" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
          <span className="rec-select-dim">{rect.w}×{rect.h}</span>
        </div>
      )}
      {!rect && <div className="rec-select-hint">Drag to select a region · Esc to cancel</div>}
    </div>
  );
}
