import { HardDrive } from "lucide-react";
import { Section, Field, Card } from "../../components/ui";

/** Default paths for display. Phase 2 will query these from Rust. */
const DB_PATH = "%APPDATA%\\com.glint.app\\glint.db";
const CAPTURES_PATH = "%APPDATA%\\com.glint.app\\captures\\";
const LOGS_PATH = "%APPDATA%\\com.glint.app\\logs\\";

export function Storage() {
  return (
    <Section
      title="Storage"
      description="Where Glint stores your data on disk."
    >
      <Card>
        <div className="settings-storage-list">
          <div className="settings-storage-row">
            <span className="settings-storage-key">
              <HardDrive size={13} strokeWidth={1.75} />
              Database
            </span>
            <code className="settings-storage-path">{DB_PATH}</code>
          </div>
          <div className="settings-storage-row">
            <span className="settings-storage-key">
              <HardDrive size={13} strokeWidth={1.75} />
              Captures
            </span>
            <code className="settings-storage-path">{CAPTURES_PATH}</code>
          </div>
          <div className="settings-storage-row">
            <span className="settings-storage-key">
              <HardDrive size={13} strokeWidth={1.75} />
              Logs
            </span>
            <code className="settings-storage-path">{LOGS_PATH}</code>
          </div>
        </div>
      </Card>

      <Field label="Capture folder" hint="Change where screenshots and recordings are saved.">
        <span className="settings-phase-note" style={{ marginTop: 0 }}>
          Custom capture folder is available in a later phase
        </span>
      </Field>

      <Field label="Retention" hint="Automatically delete captures older than a set period.">
        <span className="settings-phase-note" style={{ marginTop: 0 }}>
          Retention policy is available in a later phase
        </span>
      </Field>
    </Section>
  );
}
