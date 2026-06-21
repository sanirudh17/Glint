/**
 * Crosshair.tsx — Full-viewport guide lines for the Glint area capture overlay.
 *
 * Two 1px hairlines (horizontal + vertical) track the cursor before a selection
 * is established. Once a selection exists (rect with w > 1 and h > 1), the
 * crosshair hides — it has served its aiming purpose and would only clutter
 * the editing state.
 *
 * Design: white at 25% opacity — subordinate to the accent border, readable
 * over any desktop background. No glow, no drop shadow, no animation.
 * pointer-events: none so they never interfere with the drag layer.
 */

import { useEffect, useState } from "react";
import type { Rect } from "./modes";

interface CrosshairProps {
  /** Current selection rect, or null if none exists yet. */
  rect: Rect | null;
}

export function Crosshair({ rect }: CrosshairProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      setPos({ x: e.clientX, y: e.clientY });
    }
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Hide once the user has an active selection (w > 1 and h > 1).
  // During the very first pixel of a drag (w=0, h=0) the crosshair is
  // still absent because pos is tracked, but it fades immediately —
  // the selection border takes over as the visual anchor.
  const hasSelection = rect !== null && rect.w > 1 && rect.h > 1;

  if (!pos || hasSelection) return null;

  return (
    <div className="sl-crosshair" aria-hidden>
      {/* Horizontal guide — full viewport width */}
      <div
        className="sl-crosshair-h"
        style={{ top: pos.y }}
      />
      {/* Vertical guide — full viewport height */}
      <div
        className="sl-crosshair-v"
        style={{ left: pos.x }}
      />
    </div>
  );
}
