/**
 * HudApp.tsx — root of the post-capture HUD (route #/hud).
 *
 * A CleanShot-style corner card: a compact thumbnail of the shot you just took,
 * parked in the bottom-left of the capture monitor. Quiet by default — just the
 * preview, its dimensions, and a close button. The action toolbar (Copy / Copy
 * path / Save / Annotate / Pin) reveals over the bottom edge on hover.
 *
 * The thumbnail is the drag handle: press and drag it to drop the real PNG into
 * any app. Viewfinder corner ticks echo the capture crosshair. Esc dismisses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHudData,
  hudCopy,
  hudCopyPath,
  hudSave,
  hudReveal,
  hudDismiss,
  dragOut,
  type HudData,
} from "../lib/hudIpc";
import { HudActions, type HudAction } from "./HudActions";
import { X } from "lucide-react";
import "./hud.css";

export function HudApp() {
  const [data, setData] = useState<HudData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<number | null>(null);

  // Fetch the current capture result. On failure, close the HUD so we never
  // strand an empty card on screen.
  useEffect(() => {
    getHudData().then(setData).catch(() => hudDismiss());
  }, []);

  // Esc dismisses, mirroring the capture overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hudDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Inline confirmations — the HUD owns its own feedback (the main window may be
  // hidden). Each message auto-clears.
  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 1900);
  }, []);

  const onAction = useCallback(
    async (a: HudAction) => {
      switch (a) {
        case "copy":
          await hudCopy().then(() => flash("Copied to clipboard")).catch(() => flash("Couldn't copy"));
          break;
        case "copy-path":
          await hudCopyPath().then(() => flash("Path copied")).catch(() => flash("Couldn't copy path"));
          break;
        case "save":
          if (data?.saved) {
            await hudReveal().then(() => flash("Revealed in folder")).catch(() => flash("Couldn't reveal"));
          } else {
            await hudSave().then((dest) => flash(`Saved · ${fileName(dest)}`)).catch(() => flash("Couldn't save"));
          }
          break;
        case "annotate":
          flash("Annotation arrives in Phase 5");
          break;
        case "pin":
          flash("Pinning arrives in Phase 7");
          break;
        case "dismiss":
          hudDismiss();
          break;
      }
    },
    [flash, data],
  );

  // Drag-out: lift the real PNG from the thumbnail into any app.
  function onThumbPointerDown() {
    if (data) dragOut(data.path);
  }

  return (
    <div className="hud-root">
      <div className={`hud-card${data ? "" : " hud-card--loading"}`}>
        {/* Drag surface — sits beneath the overlays so toolbar/close clicks
            never start a drag. */}
        <div
          className="hud-drag"
          onPointerDown={onThumbPointerDown}
          role="img"
          aria-label="Captured image — drag to share"
          title="Drag to share"
        >
          {data && (
            <img className="hud-thumb-img" src={data.imageDataUrl} alt="" draggable={false} />
          )}
        </div>

        {/* Viewfinder corner ticks. */}
        <span className="hud-tick hud-tick--tl" />
        <span className="hud-tick hud-tick--tr" />
        <span className="hud-tick hud-tick--bl" />
        <span className="hud-tick hud-tick--br" />

        {data && (
          <span className="hud-dims">
            {data.width}<span className="hud-dims-x">×</span>{data.height}
          </span>
        )}

        <button
          type="button"
          className="hud-close"
          aria-label="Dismiss"
          data-tip="Dismiss"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onAction("dismiss")}
        >
          <X size={13} strokeWidth={2} />
        </button>

        {/* Scrim + action toolbar — revealed on hover. */}
        <div className="hud-scrim" aria-hidden="true" />
        <HudActions onAction={onAction} saved={data?.saved ?? false} />

        {/* Inline confirmation, layered over the card. */}
        <div className={`hud-status${status ? " hud-status--show" : ""}`} aria-live="polite">
          {status}
        </div>
      </div>
    </div>
  );
}

/** Last path segment, for compact save confirmations. */
function fileName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
