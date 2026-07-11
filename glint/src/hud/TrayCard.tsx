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
      // Show feedback IMMEDIATELY, before awaiting the backend. The commands are async
      // (worker-thread) but still take real time — clipboard encode, file IO, OCR can
      // run up to ~1s — and gating the status line behind the await made every button
      // feel like it lagged a beat. Flash optimistically, run the command, and correct
      // to an error only if it actually fails.
      try {
        switch (a) {
          case "copy": flash("Copied to clipboard"); await trayCopy(item.id); break;
          case "copy-path": flash("Path copied"); await trayCopyPath(item.id); break;
          case "save":
            if (saved) { flash("Revealed in folder"); await trayReveal(item.id); }
            else { flash("Saved to Library"); await traySave(item.id); setSaved(true); }
            break;
          case "annotate": await trayAnnotate(item.id); break;
          // OCR is genuinely slow, so a truthful two-step: acknowledge on press, then
          // confirm when the text is actually out.
          case "extract-text": flash("Extracting text…"); await trayExtractText(item.id); flash("Text extracted"); break;
          case "pin": flash("Pinned"); await trayPin(item.id); break;
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
