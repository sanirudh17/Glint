/**
 * TrayCard.tsx — one capture card in the Quick Access Overlay stack. Mirrors the
 * old single-HUD card: a drag-handle thumbnail, viewfinder ticks, dimensions, a
 * corner Delete, the hover action toolbar, and its own inline status line. Actions
 * target this card's id.
 */
import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { HudActions, type HudAction } from "./HudActions";
import {
  type TrayItem,
  trayCopy,
  trayCopyPath,
  traySave,
  trayReveal,
  trayPin,
  trayAnnotate,
  trayExtractText,
  trayDismiss,
  dragOut,
} from "../lib/hudIpc";

export function TrayCard({ item, onChanged }: { item: TrayItem; onChanged: () => void }) {
  const [saved, setSaved] = useState(item.saved);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(null), 1900);
  }, []);

  const onAction = useCallback(
    async (a: HudAction) => {
      try {
        switch (a) {
          case "copy": await trayCopy(item.id); flash("Copied to clipboard"); break;
          case "copy-path": await trayCopyPath(item.id); flash("Path copied"); break;
          case "save":
            if (saved) { await trayReveal(item.id); flash("Revealed in folder"); }
            else { await traySave(item.id); setSaved(true); flash("Saved to Library"); }
            break;
          case "annotate": await trayAnnotate(item.id); break;
          case "extract-text": await trayExtractText(item.id); flash("Text extracted"); break;
          case "pin": await trayPin(item.id); flash("Pinned"); break;
          case "dismiss": await trayDismiss(item.id); onChanged(); break;
        }
      } catch {
        flash("Something went wrong");
      }
    },
    [item.id, saved, flash, onChanged],
  );

  return (
    <div className="hud-card">
      <div
        className="hud-drag"
        onPointerDown={() => dragOut(item.path)}
        role="img"
        aria-label="Captured image — drag to share"
        title="Drag to share"
      >
        <img className="hud-thumb-img" src={item.thumb} alt="" draggable={false} />
      </div>

      <span className="hud-tick hud-tick--tl" />
      <span className="hud-tick hud-tick--tr" />
      <span className="hud-tick hud-tick--bl" />
      <span className="hud-tick hud-tick--br" />

      <span className="hud-dims">
        {item.width}<span className="hud-dims-x">×</span>{item.height}
      </span>

      <button
        type="button"
        className="hud-close"
        aria-label="Dismiss"
        title="Dismiss"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onAction("dismiss")}
      >
        <X size={13} strokeWidth={2} />
      </button>

      <div className="hud-scrim" aria-hidden="true" />
      <HudActions onAction={onAction} saved={saved} />

      <div className={`hud-status${status ? " hud-status--show" : ""}`} aria-live="polite">
        {status}
      </div>
    </div>
  );
}
