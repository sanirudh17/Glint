import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";

export function General() {
  return (
    <Section
      title="General"
      description="App-wide behaviour settings."
    >
      <Field label="Launch at login" hint="Start Glint automatically when you sign in to Windows.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Show in taskbar" hint="Keep Glint visible in the Windows taskbar alongside the tray.">
        <div className="settings-inert-control">
          <Switch checked={true} onChange={() => {}} />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Sound effects" hint="Play a shutter sound on capture.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
    </Section>
  );
}
