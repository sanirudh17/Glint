/**
 * Settings → Updates. The always-available manual path: check GitHub for a newer
 * release and install it. After the popup is dismissed this is the only way to
 * update; it's also where you land to update on demand.
 *
 * Layout mirrors the other settings panels: a compact framed row (current version
 * + a small "Check now" button), then a status line that only appears once there's
 * something to report — up-to-date, an accent callout for an available update, a
 * download progress bar, or an error.
 */
import { useEffect, useState } from "react";
import { RefreshCw, ArrowUpCircle, Check, AlertCircle } from "lucide-react";
import { Section } from "../../components/ui";
import { useUpdater } from "../../update/useUpdater";
import { getCurrentVersion } from "../../update/github";
import { pct, progressLabel } from "../../update/progress";
import "../../update/update.css";

export function Updates() {
  const { status, check, install } = useUpdater();
  const [current, setCurrent] = useState<string>("");

  useEffect(() => {
    getCurrentVersion().then(setCurrent).catch(() => {});
  }, []);

  const checking = status.kind === "checking";
  const busy = checking || status.kind === "downloading";

  // Prefer a version we learned from a check; fall back to the mount-time fetch.
  const shown =
    status.kind === "uptodate" || status.kind === "available" ? status.current : current;

  return (
    <Section title="Updates" description="Check for and install new versions of Glint.">
      <div className="settings-update-row">
        <div className="settings-update-version">
          <span className="settings-update-eyebrow">Current version</span>
          <span className="settings-update-value">v{shown || "…"}</span>
        </div>
        <button
          type="button"
          className="settings-hotkey-btn settings-update-check"
          onClick={() => void check()}
          disabled={busy}
        >
          <RefreshCw size={13} strokeWidth={1.75} className={checking ? "settings-update-spin" : ""} />
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>

      {status.kind === "uptodate" && (
        <p className="settings-update-note settings-update-note--ok">
          <Check size={14} strokeWidth={2.25} />
          You're on the latest version.
        </p>
      )}

      {status.kind === "available" && (
        <div className="settings-update-callout">
          <div className="settings-update-callout-text">
            <span className="settings-update-callout-title">Glint v{status.latest} is available</span>
            <span className="settings-update-callout-sub">You're on v{status.current}.</span>
          </div>
          <button
            type="button"
            className="settings-hotkey-btn settings-update-install"
            onClick={() => void install(status.assetUrl, status.latest)}
          >
            <ArrowUpCircle size={14} strokeWidth={2} />
            Update now
          </button>
        </div>
      )}

      {status.kind === "downloading" && (
        <div className="settings-update-progress">
          <span className="settings-update-note">Downloading v{status.version}…</span>
          <div className="upd-progress">
            <div
              className={`upd-progress-fill${pct(status.downloaded, status.total) === null ? " upd-progress-fill--indeterminate" : ""}`}
              style={{ width: `${pct(status.downloaded, status.total) ?? 35}%` }}
            />
          </div>
          <span className="upd-meta">{progressLabel(status.downloaded, status.total)}</span>
        </div>
      )}

      {status.kind === "launching" && (
        <p className="settings-update-note">Installer launched — Glint will close to finish updating.</p>
      )}

      {status.kind === "error" && (
        <p className="settings-update-note settings-update-note--error">
          <AlertCircle size={14} strokeWidth={2} />
          {status.message}
        </p>
      )}
    </Section>
  );
}
