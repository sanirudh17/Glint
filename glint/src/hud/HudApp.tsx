/**
 * HudApp.tsx — root of the post-capture HUD (route #/hud).
 *
 * Mounted in a borderless, transparent, always-on-top webview at the bottom-centre
 * of the capture monitor. Renders an "instrument glass" bar: the capture thumbnail
 * (which is itself the drag handle) plus an action row.
 *
 * The thumbnail wears viewfinder corner ticks — a nod to the capture crosshair —
 * marking it as the shot you just took, ready to lift into any app.
 *
 * No app chrome here (no Titlebar / NavRail). Esc dismisses.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getHudData,
  hudCopy,
  hudCopyPath,
  hudSave,
  hudDismiss,
  dragOut,
  type HudData,
} from "../lib/hudIpc";
import { HudActions, type HudAction } from "./HudActions";
import "./hud.css";

export function HudApp() {
  const [data, setData] = useState<HudData | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef<number | null>(null);

  // Fetch the current capture result. On failure, close the HUD so we never
  // strand an empty bar on screen.
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
          await hudSave().then((dest) => flash(`Saved · ${fileName(dest)}`)).catch(() => flash("Couldn't save"));
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
    [flash],
  );

  // Drag-out: lift the real PNG from the thumbnail into any app.
  function onThumbPointerDown() {
    if (data) dragOut(data.path);
  }

  return (
    <div className="hud-root">
      <div className="hud-bar">
        {/* Thumbnail — the drag handle. */}
        <div
          className={`hud-thumb${data ? "" : " hud-thumb--loading"}`}
          onPointerDown={onThumbPointerDown}
          role="img"
          aria-label="Captured image — drag to share"
          title="Drag to share"
        >
          {data && (
            <img className="hud-thumb-img" src={data.imageDataUrl} alt="" draggable={false} />
          )}
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
        </div>

        <span className="hud-divider hud-divider--lead" aria-hidden="true" />

        <HudActions onAction={onAction} />

        {/* Inline confirmation, layered over the bar. */}
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
