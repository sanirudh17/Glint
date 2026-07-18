/**
 * SelectionLayer.tsx — Area selection mode for the Glint capture overlay.
 *
 * Interaction model:
 *   • Pointer-down on empty area  → start a fresh selection drag
 *   • Pointer-move during drag    → update rect via normalizeRect
 *   • Pointer-up                  → keep rect editable (no auto-commit)
 *   • Pointer-down on handle      → resize from that edge/corner
 *   • Pointer-down inside rect    → move the whole selection
 *   • Double-click inside / Enter → commit via commitCapture (if w,h > 1)
 *
 * Dimmed surround: 4 absolutely-positioned panels (top / right / bottom / left)
 * create the "hole" effect — the frozen image shows through the un-overlaid gap.
 * No box-shadow approach: 4 panels give pixel-perfect clip with zero compositing
 * edge cases when the rect touches the viewport boundary.
 *
 * Design language: "ink on glass" — accent #5B7CFA, 1px crisp border, handles
 * that are precise instruments not generic drag squares.
 *
 * Mount points for upcoming tasks:
 *   - Task 10: <CrosshairHUD /> and <DimensionsBadge /> inside .sl-rect-inner
 *   - Task 11: <Loupe /> as a sibling of .sl-rect inside .ov-layer
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRect, type Rect } from "./modes";
import { commitCapture } from "../lib/captureIpc";
import { Crosshair } from "./Crosshair";
import { DimensionsBadge } from "./DimensionsBadge";
import { Loupe } from "./Loupe";
import { seedCursor, isLoupeVisible, type Point } from "./loupeVisibility";

// ─── Handle descriptors ───────────────────────────────────────────────────────

type HandleId =
  | "nw" | "n" | "ne"
  | "w"         | "e"
  | "sw" | "s" | "se";

interface HandleDef {
  id: HandleId;
  cursor: string;
  /** Position as fraction of rect size: [x, y] */
  anchor: [number, number];
  /** Which edges this handle moves: dx sign for x, dy sign for y */
  xEdge: -1 | 0 | 1;
  yEdge: -1 | 0 | 1;
  shape: "corner" | "edge-h" | "edge-v";
}

const HANDLES: HandleDef[] = [
  { id: "nw", cursor: "nw-resize",  anchor: [0,   0  ], xEdge: -1, yEdge: -1, shape: "corner" },
  { id: "n",  cursor: "n-resize",   anchor: [0.5, 0  ], xEdge:  0, yEdge: -1, shape: "edge-h" },
  { id: "ne", cursor: "ne-resize",  anchor: [1,   0  ], xEdge:  1, yEdge: -1, shape: "corner" },
  { id: "w",  cursor: "w-resize",   anchor: [0,   0.5], xEdge: -1, yEdge:  0, shape: "edge-v" },
  { id: "e",  cursor: "e-resize",   anchor: [1,   0.5], xEdge:  1, yEdge:  0, shape: "edge-v" },
  { id: "sw", cursor: "sw-resize",  anchor: [0,   1  ], xEdge: -1, yEdge:  1, shape: "corner" },
  { id: "s",  cursor: "s-resize",   anchor: [0.5, 1  ], xEdge:  0, yEdge:  1, shape: "edge-h" },
  { id: "se", cursor: "se-resize",  anchor: [1,   1  ], xEdge:  1, yEdge:  1, shape: "corner" },
];

// ─── Drag state ───────────────────────────────────────────────────────────────

type DragMode =
  | { kind: "draw";   startX: number; startY: number }
  | { kind: "move";   startX: number; startY: number; origRect: Rect }
  | { kind: "resize"; startX: number; startY: number; origRect: Rect; handle: HandleDef };

// ─── Component ────────────────────────────────────────────────────────────────

export function SelectionLayer({
  monitorId,
  scale,
  imageDataUrl,
  cursorX,
  cursorY,
}: {
  monitorId: number;
  scale: number;
  imageDataUrl: string;
  /** Backend-supplied cursor position — see loupeVisibility.ts for why. */
  cursorX: number | null;
  cursorY: number | null;
}) {
  const [rect, setRect] = useState<Rect | null>(null);
  const drag = useRef<DragMode | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  // ── Loupe state: frozen bitmap (decoded once), live cursor, interaction flag ──
  //
  // The cursor is SEEDED from the backend rather than starting null: the overlay
  // is shown under a stationary mouse, which fires no pointermove, so a null start
  // left the loupe invisible until the user jiggled the mouse (it only looked
  // intermittent because an incidental twitch usually supplied that move).
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [cursor, setCursor] = useState<Point | null>(() => seedCursor(cursorX, cursorY));
  const [interacting, setInteracting] = useState(false);

  // Re-seed when a reused overlay window loads a new frozen frame (the window is
  // pre-warmed and reused across captures, so mount-time state alone is stale).
  useEffect(() => {
    setCursor(seedCursor(cursorX, cursorY));
  }, [cursorX, cursorY]);

  // Decode the frozen image into an ImageBitmap once — the loupe samples it.
  useEffect(() => {
    let cancelled = false;
    let made: ImageBitmap | null = null;
    fetch(imageDataUrl)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bmp) => {
        if (cancelled) { bmp.close(); return; }
        made = bmp;
        setBitmap(bmp);
      })
      .catch(() => { /* loupe simply won't render; selection still works */ });
    return () => {
      cancelled = true;
      made?.close();
    };
  }, [imageDataUrl]);

  // ── Commit ──────────────────────────────────────────────────────────────────

  const confirm = useCallback(() => {
    if (rect && rect.w > 1 && rect.h > 1) {
      commitCapture(rect, monitorId);
    }
  }, [rect, monitorId]);

  // ── Global keydown: Enter to commit (Esc handled in OverlayApp) ────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  // ── Layer pointer events: start draw or move ─────────────────────────────────

  function onLayerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Only handle direct clicks on the layer itself (not bubbled from handles/rect)
    if (e.target !== layerRef.current) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "draw", startX: e.clientX, startY: e.clientY };
    setInteracting(true);
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }

  function onLayerPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Track the cursor for the loupe on every move (hover and drag alike).
    setCursor({ x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    e.preventDefault();

    if (d.kind === "draw") {
      setRect(normalizeRect(d.startX, d.startY, e.clientX, e.clientY));
    } else if (d.kind === "move") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setRect({
        x: d.origRect.x + dx,
        y: d.origRect.y + dy,
        w: d.origRect.w,
        h: d.origRect.h,
      });
    } else if (d.kind === "resize") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const h = d.handle;
      const o = d.origRect;

      let x = o.x, y = o.y, w = o.w, ht = o.h;

      if (h.xEdge === -1) {
        // Moving left edge → shift x, shrink width
        const newX = o.x + dx;
        const newW = o.w - dx;
        if (newW > 1) { x = newX; w = newW; }
      } else if (h.xEdge === 1) {
        // Moving right edge → grow width only
        const newW = o.w + dx;
        if (newW > 1) { w = newW; }
      }

      if (h.yEdge === -1) {
        const newY = o.y + dy;
        const newH = o.h - dy;
        if (newH > 1) { y = newY; ht = newH; }
      } else if (h.yEdge === 1) {
        const newH = o.h + dy;
        if (newH > 1) { ht = newH; }
      }

      setRect({ x, y, w, h: ht });
    }
  }

  function onLayerPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    drag.current = null;
    setInteracting(false);
  }

  // ── Selection rect: start move ───────────────────────────────────────────────

  function onRectPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!rect) return;
    // Capture on the layer so move events route there
    layerRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "move", startX: e.clientX, startY: e.clientY, origRect: rect };
    setInteracting(true);
  }

  // ── Handle: start resize ─────────────────────────────────────────────────────

  function onHandlePointerDown(e: React.PointerEvent<HTMLDivElement>, handle: HandleDef) {
    e.preventDefault();
    e.stopPropagation();
    if (!rect) return;
    layerRef.current?.setPointerCapture(e.pointerId);
    drag.current = { kind: "resize", startX: e.clientX, startY: e.clientY, origRect: rect, handle };
    setInteracting(true);
  }

  // ── Confirm on double-click inside selection ──────────────────────────────────

  function onRectDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    confirm();
  }

  return (
    <div
      ref={layerRef}
      className="ov-layer sl-layer"
      onPointerDown={onLayerPointerDown}
      onPointerMove={onLayerPointerMove}
      onPointerUp={onLayerPointerUp}
      tabIndex={-1}
    >
      {/* ── Task 10: Crosshair guides (visible before/without an active selection) */}
      <Crosshair rect={rect} />

      {rect && (
        <SelectionBox
          rect={rect}
          onRectPointerDown={onRectPointerDown}
          onHandlePointerDown={onHandlePointerDown}
          onDoubleClick={onRectDoubleClick}
          showHint={rect.w > 40 && rect.h > 40}
        />
      )}

      {/* ── Task 10: DimensionsBadge — fixed-positioned, outside the rect */}
      {rect && rect.w > 1 && rect.h > 1 && (
        <DimensionsBadge rect={rect} scale={scale} />
      )}

      {/* ── Loupe: pixel-peeping magnifier + hex readout (Task 11) ──────────────
          Visible while aiming (no selection yet) or during an active drag —
          hidden once a selection is settled so it doesn't obscure the result. */}
      {isLoupeVisible({
        cursor,
        hasBitmap: bitmap !== null,
        hasRect: rect !== null,
        interacting,
      }) && (
        <Loupe bitmap={bitmap!} cx={cursor!.x} cy={cursor!.y} scale={scale} />
      )}
    </div>
  );
}

// ─── SelectionBox ─────────────────────────────────────────────────────────────
//
// Renders the 4-panel dimmed surround, the 1px accent border, and the 8 handles.
// The "hole" is implicit: the 4 panels cover everything *except* the selection.
// The frozen background image shows through that gap pixel-perfectly.

interface SelectionBoxProps {
  rect: Rect;
  onRectPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onHandlePointerDown: (e: React.PointerEvent<HTMLDivElement>, h: HandleDef) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  showHint: boolean;
}

function SelectionBox({
  rect,
  onRectPointerDown,
  onHandlePointerDown,
  onDoubleClick,
  showHint,
}: SelectionBoxProps) {
  const { x, y, w, h } = rect;

  // Viewport dimensions — used to build the surrounding panels.
  // These are logical px, matching clientX/clientY coordinate space.
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <>
      {/* ── Dimmed surround — 4 panels ────────────────────────────────────── */}
      {/* Top panel: full width, from top to selection top */}
      <div className="sl-dim" style={{ top: 0, left: 0, width: vw, height: y }} />
      {/* Bottom panel: full width, from selection bottom to viewport bottom */}
      <div className="sl-dim" style={{ top: y + h, left: 0, width: vw, height: Math.max(0, vh - y - h) }} />
      {/* Left panel: between top and bottom panels, left of selection */}
      <div className="sl-dim" style={{ top: y, left: 0, width: x, height: h }} />
      {/* Right panel: between top and bottom panels, right of selection */}
      <div className="sl-dim" style={{ top: y, left: x + w, width: Math.max(0, vw - x - w), height: h }} />

      {/* ── Selection rect — the "hole" ───────────────────────────────────── */}
      <div
        className="sl-rect"
        style={{ left: x, top: y, width: w, height: h }}
        onPointerDown={onRectPointerDown}
        onDoubleClick={onDoubleClick}
      >
        {/* ── Task 10: Crosshair HUD + Dimensions badge mount point ──────────
            Inside sl-rect-inner — these overlay the selection without affecting
            the border. Insert as children here:
              <DimensionsBadge w={w} h={h} />
              <CrosshairHUD … />
         ─────────────────────────────────────────────────────────────────── */}
        <div className="sl-rect-inner">
          {/* Confirm hint — shown only once the selection is large enough */}
          {showHint && (
            <div className="sl-confirm-hint">
              ↵ Enter
            </div>
          )}
        </div>

        {/* ── 8 resize handles ───────────────────────────────────────────── */}
        {HANDLES.map((handle) => (
          <div
            key={handle.id}
            className={`sl-handle sl-handle--${handle.shape} sl-handle--${handle.id}`}
            style={{ cursor: handle.cursor }}
            onPointerDown={(e) => onHandlePointerDown(e, handle)}
          />
        ))}
      </div>
    </>
  );
}
