/**
 * Settings → Updates. The always-available manual path: check GitHub for a newer
 * release and install it. After the popup is dismissed this is the only way to
 * update; it's also where you land to update on demand.
 */
import { useEffect, useState } from "react";
import { RefreshCw, ArrowUpCircle, CheckCircle2, AlertCircle } from "lucide-react";
import { Section, Field, Button } from "../../components/ui";
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

  return (
    <Section title="Updates" description="Check for and install new versions of Glint.">
      <Field
        label="Check for updates"
        hint="Glint compares your version against the latest release on GitHub and installs it if there's a newer one."
      >
        <Button
          variant="subtle"
          size="sm"
          icon={RefreshCw}
          onClick={() => void check()}
          disabled={busy}
        >
          {checking ? "Checking…" : "Check now"}
        </Button>
      </Field>

      <div className="upd-panel-status" role="status" aria-live="polite">
        {status.kind === "idle" && current && (
          <span className="upd-panel-current">You're on v{current}.</span>
        )}

        {status.kind === "checking" && <span>Checking for updates…</span>}

        {status.kind === "uptodate" && (
          <span>
            <CheckCircle2 size={15} strokeWidth={2} style={{ color: "var(--accent)", verticalAlign: "-2px", marginRight: 6 }} />
            You're on the latest version <strong>&nbsp;(v{status.current})</strong>.
          </span>
        )}

        {status.kind === "available" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)", width: "100%" }}>
            <span>
              <strong>v{status.latest}</strong> is available — you're on v{status.current}.
            </span>
            <div style={{ display: "flex", gap: "var(--s2)" }}>
              <Button variant="primary" size="sm" icon={ArrowUpCircle}
                onClick={() => void install(status.assetUrl, status.latest)}>
                Update to v{status.latest}
              </Button>
            </div>
          </div>
        )}

        {status.kind === "downloading" && (
          <div style={{ width: "100%" }}>
            <span>Downloading v{status.version}…</span>
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
          <span>Installer launched — Glint will close to finish updating.</span>
        )}

        {status.kind === "error" && (
          <span className="upd-error">
            <AlertCircle size={15} strokeWidth={2} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            {status.message}
          </span>
        )}
      </div>
    </Section>
  );
}
