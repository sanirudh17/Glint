import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";

export function AutoSave() {
  return (
    <Section
      title="Auto-save"
      description="Automatically save captures to disk after taking them."
    >
      <Field label="Auto-save captures" hint="Save each capture to the configured folder without prompting.">
        <div className="settings-inert-control">
          <Switch checked={true} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Auto-copy to clipboard" hint="Copy the capture to the clipboard immediately after saving.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Open in editor after capture" hint="Open each capture in the editor view automatically.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
    </Section>
  );
}
