/**
 * Settings → Updates. The always-available manual path: check GitHub for a newer
 * release and install it. After the popup is dismissed this is the only way to
 * update; it's also where you land to update on demand.
 *
 * One card: the app, its version, a live status line, and the action (check, or
 * install when a newer release exists). Download progress runs inside the card.
 */
import { useEffect, useState } from "react";
import { RefreshCw, ArrowUpCircle, Check, AlertCircle } from "../../icons";
import { Section } from "../../components/ui";
import appIcon from "../../../src-tauri/icons/128x128.png";
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

  const latest = status.kind === "available" ? status.latest : null;
  return (
    <Section title="Updates">
      <div className={`settings-update-card${latest ? " is-available" : ""}`}>
        <img className="settings-update-icon" src={appIcon} width={44} height={44} alt="" />
        <div className="settings-update-meta">
          <span className="settings-update-name">Glint</span>
          <span className="settings-update-version">Version {shown || "…"}</span>
          <span
            className={`settings-update-status${status.kind === "error" ? " is-error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {status.kind === "uptodate" && <><Check size={13} strokeWidth={2.25} /> You're on the latest version</>}
            {status.kind === "available" && <><ArrowUpCircle size={13} strokeWidth={1.75} /> Version {status.latest} is available</>}
            {status.kind === "checking" && "Checking GitHub releases…"}
            {status.kind === "launching" && "Installer launched — Glint will close to finish updating"}
            {status.kind === "error" && <><AlertCircle size={13} strokeWidth={1.75} /> {status.message}</>}
            {status.kind === "downloading" && `Downloading version ${status.version}…`}
            {status.kind === "idle" && "Glint checks for updates each time it starts"}
          </span>
        </div>
        {latest && status.kind === "available" ? (
          <button
            type="button"
            className="settings-hotkey-btn settings-update-install"
            onClick={() => void install(status.assetUrl, status.latest)}
          >
            Update to {latest}
          </button>
        ) : (
          <button type="button" className="settings-hotkey-btn" onClick={() => void check()} disabled={busy}>
            <RefreshCw size={13} strokeWidth={1.5} className={checking ? "settings-update-spin" : ""} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
        )}
        {status.kind === "downloading" && (
          <div className="settings-update-progress">
            <div className="upd-progress">
              <div
                className={`upd-progress-fill${pct(status.downloaded, status.total) === null ? " upd-progress-fill--indeterminate" : ""}`}
                style={{ width: `${pct(status.downloaded, status.total) ?? 35}%` }}
              />
            </div>
            <span className="upd-meta">{progressLabel(status.downloaded, status.total)}</span>
          </div>
        )}
      </div>
    </Section>
  );
}
