/**
 * FullscreenMode.tsx — whole-monitor capture.
 *
 * The entire frozen monitor is the target. A subtle accent inset frame marks
 * the boundary and a centred hint card invites confirmation. Click anywhere or
 * press Enter to commit the full screen; Esc (handled in OverlayApp) cancels.
 *
 * Coordinate model: OverlayData.width/height are PHYSICAL px (the frozen image).
 * commitCapture expects LOGICAL px, so we divide by `scale`. The hint shows the
 * physical dimensions — what the saved PNG actually measures.
 */

import { useCallback, useEffect } from "react";
import { commitCapture } from "../lib/captureIpc";

interface FullscreenModeProps {
  monitorId: number;
  /** Frozen image width in PHYSICAL px. */
  width: number;
  /** Frozen image height in PHYSICAL px. */
  height: number;
  /** Monitor scale factor (physical / logical). */
  scale: number;
}

export function FullscreenMode({ monitorId, width, height, scale }: FullscreenModeProps) {
  const confirm = useCallback(() => {
    // Logical rect covering the whole monitor.
    commitCapture({ x: 0, y: 0, w: width / scale, h: height / scale }, monitorId);
  }, [width, height, scale, monitorId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm]);

  return (
    <div className="fs-layer" onClick={confirm}>
      <div className="fs-frame" aria-hidden />
      <div className="fs-hint" role="status">
        <span className="fs-hint-title">Capture full screen</span>
        <span className="fs-hint-dims">
          {width}
          <span className="fs-hint-sep">×</span>
          {height}
        </span>
        <span className="fs-hint-key">Click or press ↵ Enter</span>
      </div>
    </div>
  );
}
