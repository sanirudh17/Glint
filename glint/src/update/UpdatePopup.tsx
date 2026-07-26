/**
 * UpdatePopup — the one-time, per-version "an update is available" card.
 *
 * Behaviour (per the product spec):
 *   • On launch it checks GitHub once. It appears ONLY when a strictly newer
 *     version exists AND the user hasn't already dismissed the popup for that
 *     exact version (persisted in localStorage → survives restarts).
 *   • Dismissing (X) records this version and never nags again for it — but a
 *     later release shows its own popup once. After dismissal the only path to
 *     update is Settings → Updates.
 *   • Check failures (offline / rate-limited) are silent here — no error card
 *     unsolicited. Errors during an in-progress download DO show, since the user
 *     asked for that.
 *
 * Only mounted in the main window (see UpdateGate).
 */
import { useEffect, useState } from "react";
import { ArrowUpCircle, X } from "lucide-react";
import { Button } from "../components/ui";
import { useUpdater } from "./useUpdater";
import { shouldNotify } from "./version";
import { pct, progressLabel, DISMISS_KEY } from "./progress";
import "./update.css";

export function UpdatePopup() {
  const { status, check, install } = useUpdater();
  const [showing, setShowing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // One background check shortly after launch (let the app settle first).
  useEffect(() => {
    const t = setTimeout(() => void check(), 2000);
    return () => clearTimeout(t);
  }, [check]);

  // Reveal only for a newer, not-already-dismissed version. Once shown, stay shown
  // through downloading/launching/error so the user sees the outcome of Update.
  useEffect(() => {
    if (status.kind === "available") {
      const saved = localStorage.getItem(DISMISS_KEY);
      if (shouldNotify({ latest: status.latest, current: status.current, dismissed: saved })) {
        setShowing(true);
      }
    }
  }, [status]);

  if (!showing || dismissed) return null;

  const version =
    status.kind === "available"
      ? status.latest
      : "version" in status
        ? status.version
        : "";

  function onDismiss() {
    if (version) {
      try { localStorage.setItem(DISMISS_KEY, version); } catch { /* no storage */ }
    }
    setDismissed(true);
  }

  return (
    <div className="upd-popup" role="dialog" aria-label="Software update available">
      <div className="upd-head">
        <span className="upd-badge"><ArrowUpCircle size={16} strokeWidth={2} /></span>
        <span className="upd-title">Update available</span>
        {status.kind !== "downloading" && status.kind !== "launching" && (
          <button type="button" className="upd-dismiss" aria-label="Dismiss" onClick={onDismiss}>
            <X size={15} strokeWidth={2} />
          </button>
        )}
      </div>

      {status.kind === "available" && (
        <>
          <p className="upd-body">
            Glint <strong>v{status.latest}</strong> is ready to install. You're on
            v{status.current}.
          </p>
          <div className="upd-actions">
            <Button variant="primary" size="sm" icon={ArrowUpCircle}
              onClick={() => void install(status.assetUrl, status.latest)}>
              Update now
            </Button>
          </div>
        </>
      )}

      {status.kind === "downloading" && (
        <>
          <p className="upd-body">Downloading <strong>v{version}</strong>…</p>
          <div className="upd-progress">
            <div
              className={`upd-progress-fill${pct(status.downloaded, status.total) === null ? " upd-progress-fill--indeterminate" : ""}`}
              style={{ width: `${pct(status.downloaded, status.total) ?? 35}%` }}
            />
          </div>
          <span className="upd-meta">{progressLabel(status.downloaded, status.total)}</span>
        </>
      )}

      {status.kind === "launching" && (
        <p className="upd-body">Installer launched — Glint will close to finish updating.</p>
      )}

      {status.kind === "error" && (
        <>
          <p className="upd-error">{status.message}</p>
          <div className="upd-actions" style={{ marginTop: "var(--s2)" }}>
            <Button variant="ghost" size="sm" onClick={onDismiss}>Close</Button>
          </div>
        </>
      )}
    </div>
  );
}
