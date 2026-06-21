/**
 * WindowMode.tsx — capture a single detected window.
 *
 * On pointer-move we hit-test the enumerated window list (topmost-first) and
 * highlight the window under the cursor: everything else dims, the window keeps
 * its frozen pixels, an accent border traces it, and the dimensions badge shows
 * its physical size. Click commits that window; Esc (OverlayApp) cancels.
 *
 * The window list arrives in logical/CSS px (the backend already divided by
 * scale), matching clientX/clientY. No per-move IPC — hit-testing is local.
 */

import { useState } from "react";
import { windowAt, rectFromWindow } from "./modes";
import { commitCapture, type WindowRect } from "../lib/captureIpc";
import { DimensionsBadge } from "./DimensionsBadge";

interface WindowModeProps {
  monitorId: number;
  windows: WindowRect[];
  /** Monitor scale factor — for the physical-px dimensions badge. */
  scale: number;
}

export function WindowMode({ monitorId, windows, scale }: WindowModeProps) {
  const [hover, setHover] = useState<WindowRect | null>(null);

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    setHover(windowAt(windows, e.clientX, e.clientY) ?? null);
  }

  function onClick() {
    if (hover) commitCapture(rectFromWindow(hover), monitorId);
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  return (
    <div className="wm-layer" onPointerMove={onPointerMove} onClick={onClick}>
      {hover ? (
        <>
          {/* Dim everything except the hovered window (4 clamped panels). */}
          <div className="sl-dim" style={{ top: 0, left: 0, width: vw, height: Math.max(0, hover.y) }} />
          <div
            className="sl-dim"
            style={{ top: hover.y + hover.h, left: 0, width: vw, height: Math.max(0, vh - hover.y - hover.h) }}
          />
          <div className="sl-dim" style={{ top: hover.y, left: 0, width: Math.max(0, hover.x), height: hover.h }} />
          <div
            className="sl-dim"
            style={{ top: hover.y, left: hover.x + hover.w, width: Math.max(0, vw - hover.x - hover.w), height: hover.h }}
          />

          {/* Accent highlight tracing the window. */}
          <div
            className="wm-highlight"
            style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }}
          />

          <DimensionsBadge rect={rectFromWindow(hover)} scale={scale} />
        </>
      ) : (
        <div className="wm-hint" role="status">
          Hover a window to capture it
        </div>
      )}
    </div>
  );
}
