/**
 * RegionSelect.tsx — adjustable drag-to-pick record region (#/rec-select).
 *
 * Mirrors the screenshot selection UX so recording feels identical to capture:
 *   • drag on empty space      → draw a fresh region
 *   • drag a handle            → resize from that edge/corner
 *   • drag inside the region   → move it
 *   • Enter / double-click     → confirm and start recording the region
 *   • "Record Full Screen"     → start recording the whole monitor
 *   • Esc                      → cancel
 *
 * Recorder-owned: imports nothing from overlay/ (the SACRED isolation rule), so
 * the handle/resize/badge logic is duplicated here rather than shared.
 *
 * CRITICAL (the "banished, nothing happened" bug): confirm must NOT close this
 * window before invoking. `getCurrentWindow().close()` tears down the webview's
 * JS context, so any invoke issued just before it never reaches Rust. Instead we
 * fire the IPC and let Rust close the selector once recording actually starts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Monitor } from "lucide-react";
import { recorderStartRegion, recorderStartFullscreen } from "../lib/recorder";
import "./recorder.css";

type Rect = { x: number; y: number; w: number; h: number };

type HandleId = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
interface HandleDef {
  id: HandleId;
  cursor: string;
  xEdge: -1 | 0 | 1;
  yEdge: -1 | 0 | 1;
  shape: "corner" | "edge-h" | "edge-v";
}
const HANDLES: HandleDef[] = [
  { id: "nw", cursor: "nw-resize", xEdge: -1, yEdge: -1, shape: "corner" },
  { id: "n",  cursor: "n-resize",  xEdge:  0, yEdge: -1, shape: "edge-h" },
  { id: "ne", cursor: "ne-resize", xEdge:  1, yEdge: -1, shape: "corner" },
  { id: "w",  cursor: "w-resize",  xEdge: -1, yEdge:  0, shape: "edge-v" },
  { id: "e",  cursor: "e-resize",  xEdge:  1, yEdge:  0, shape: "edge-v" },
  { id: "sw", cursor: "sw-resize", xEdge: -1, yEdge:  1, shape: "corner" },
  { id: "s",  cursor: "s-resize",  xEdge:  0, yEdge:  1, shape: "edge-h" },
  { id: "se", cursor: "se-resize", xEdge:  1, yEdge:  1, shape: "corner" },
];

type DragMode =
  | { kind: "draw"; startX: number; startY: number }
  | { kind: "move"; startX: number; startY: number; orig: Rect }
  | { kind: "resize"; startX: number; startY: number; orig: Rect; handle: HandleDef };

/** Below this many CSS px on either side we don't confirm (mirrors the Rust 16px floor). */
const MIN = 16;

function normalize(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx), h: Math.abs(ay - by) };
}

export function RegionSelect() {
  const [rect, setRect] = useState<Rect | null>(null);
  const drag = useRef<DragMode | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const confirmed = useRef(false);
  // Scale + monitor origin, fetched once. The window covers the primary monitor
  // at its physical origin and never moves, so a single read is enough.
  const [env, setEnv] = useState<{ scale: number; ox: number; oy: number }>({ scale: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const w = getCurrentWindow();
    Promise.all([w.scaleFactor(), w.outerPosition()])
      .then(([scale, pos]) => setEnv({ scale, ox: pos.x, oy: pos.y }))
      .catch(() => { /* keep 1×/origin-0 fallback */ });
  }, []);

  const close = () => { getCurrentWindow().close(); };

  const confirmRegion = useCallback(() => {
    if (confirmed.current || !rect || rect.w < MIN || rect.h < MIN) return;
    confirmed.current = true;
    // CSS px → physical px, offset by the monitor's physical origin (gdigrab needs
    // physical coords). Fire-and-forget; Rust closes this window when it starts.
    recorderStartRegion({
      x: Math.round(env.ox + rect.x * env.scale),
      y: Math.round(env.oy + rect.y * env.scale),
      w: Math.round(rect.w * env.scale),
      h: Math.round(rect.h * env.scale),
    }).catch(() => { /* a toast already surfaces start failures */ });
  }, [rect, env]);

  const confirmFullscreen = useCallback(() => {
    if (confirmed.current) return;
    confirmed.current = true;
    recorderStartFullscreen().catch(() => { /* toast surfaces failures */ });
  }, []);

  // Esc cancels (closing is safe — no follow-up IPC). Enter confirms the region.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Enter") { e.preventDefault(); confirmRegion(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRegion]);

  // ── Layer: start a fresh draw (ignore events bubbled from rect/handles/toolbar) ─
  function onLayerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.target !== layerRef.current) return;
    e.preventDefault();
    layerRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "draw", startX: e.clientX, startY: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  function onLayerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    if (d.kind === "draw") {
      setRect(normalize(d.startX, d.startY, e.clientX, e.clientY));
    } else if (d.kind === "move") {
      setRect({ x: d.orig.x + (e.clientX - d.startX), y: d.orig.y + (e.clientY - d.startY), w: d.orig.w, h: d.orig.h });
    } else {
      const dx = e.clientX - d.startX, dy = e.clientY - d.startY, o = d.orig, hd = d.handle;
      let x = o.x, y = o.y, w = o.w, h = o.h;
      if (hd.xEdge === -1) { const nx = o.x + dx, nw = o.w - dx; if (nw > 1) { x = nx; w = nw; } }
      else if (hd.xEdge === 1) { const nw = o.w + dx; if (nw > 1) w = nw; }
      if (hd.yEdge === -1) { const ny = o.y + dy, nh = o.h - dy; if (nh > 1) { y = ny; h = nh; } }
      else if (hd.yEdge === 1) { const nh = o.h + dy; if (nh > 1) h = nh; }
      setRect({ x, y, w, h });
    }
  }

  function onLayerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    drag.current = null;
  }

  function onRectPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault(); e.stopPropagation();
    if (!rect) return;
    layerRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", startX: e.clientX, startY: e.clientY, orig: rect };
  }

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>, handle: HandleDef) {
    e.preventDefault(); e.stopPropagation();
    if (!rect) return;
    layerRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", startX: e.clientX, startY: e.clientY, orig: rect, handle };
  }

  const big = rect !== null && rect.w > 40 && rect.h > 40;

  return (
    <div
      ref={layerRef}
      className="rec-sel-layer"
      onPointerDown={onLayerPointerDown}
      onPointerMove={onLayerPointerMove}
      onPointerUp={onLayerPointerUp}
    >
      {rect && <DimmedSurround rect={rect} />}

      {rect && (
        <div
          className="rec-sel-rect"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          onPointerDown={onRectPointerDown}
          onDoubleClick={(e) => { e.stopPropagation(); confirmRegion(); }}
        >
          {big && <div className="rec-sel-confirm-hint">↵ Enter</div>}
          {HANDLES.map((hd) => (
            <div
              key={hd.id}
              className={`rec-sel-handle rec-sel-handle--${hd.shape} rec-sel-handle--${hd.id}`}
              style={{ cursor: hd.cursor }}
              onPointerDown={(e) => onHandlePointerDown(e, hd)}
            />
          ))}
        </div>
      )}

      {rect && rect.w > 1 && rect.h > 1 && <DimensionsBadge rect={rect} scale={env.scale} />}

      {/* Toolbar: hint + the full-screen affordance (pointer-events only on the button). */}
      <div className="rec-sel-toolbar">
        <span className="rec-sel-hint">
          {rect ? "↵ Enter to record · drag handles to adjust · Esc to cancel"
                : "Drag to select a region · Esc to cancel"}
        </span>
        <button className="rec-sel-fullbtn" onPointerDown={(e) => e.stopPropagation()} onClick={confirmFullscreen}>
          <Monitor size={15} strokeWidth={2} /> Record Full Screen
        </button>
      </div>
    </div>
  );
}

/** 4-panel dimmed surround — the un-overlaid gap is the selection. */
function DimmedSurround({ rect }: { rect: Rect }) {
  const { x, y, w, h } = rect;
  const vw = window.innerWidth, vh = window.innerHeight;
  return (
    <>
      <div className="rec-sel-dim" style={{ top: 0, left: 0, width: vw, height: y }} />
      <div className="rec-sel-dim" style={{ top: y + h, left: 0, width: vw, height: Math.max(0, vh - y - h) }} />
      <div className="rec-sel-dim" style={{ top: y, left: 0, width: x, height: h }} />
      <div className="rec-sel-dim" style={{ top: y, left: x + w, width: Math.max(0, vw - x - w), height: h }} />
    </>
  );
}

const BADGE_W = 104, BADGE_H = 24, BADGE_M = 8;

/** Fixed-position physical-px readout with edge-flip — no longer pinned inside the
 *  rect (the old `top:-22px` badge "glitched" by clipping/jumping as the rect grew). */
function DimensionsBadge({ rect, scale }: { rect: Rect; scale: number }) {
  const { x, y, w, h } = rect;
  if (w < 2 || h < 2) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const right = x + w, bottom = y + h;
  const style: React.CSSProperties = { position: "fixed" };
  style.left = right + BADGE_M + BADGE_W > vw ? right - BADGE_W : right + BADGE_M;
  style.top = bottom + BADGE_M + BADGE_H > vh ? y - BADGE_H - BADGE_M : bottom + BADGE_M;
  return (
    <div className="rec-sel-badge" style={style} aria-live="polite">
      {Math.round(w * scale)}<span className="rec-sel-badge-sep">×</span>{Math.round(h * scale)}
    </div>
  );
}
