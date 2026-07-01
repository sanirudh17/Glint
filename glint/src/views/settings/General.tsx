import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

export function General() {
  const settings = useAppStore((s) => s.settings);
  const setExplorerMenu = useAppStore((s) => s.setExplorerMenu);

  return (
    <Section
      title="General"
      description="App-wide behaviour settings."
    >
      <Field
        label="Open in Glint (right-click menu)"
        hint="Add an &quot;Open in Glint&quot; entry to the Windows Explorer right-click menu for image files (opens the editor) and video files (opens the trimmer)."
      >
        <Switch
          checked={settings?.explorer_menu_enabled ?? true}
          onChange={(v) => setExplorerMenu(v)}
        />
      </Field>
      <Field label="Launch at login" hint="Start Glint automatically when you sign in to Windows.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Show in taskbar" hint="Keep Glint visible in the Windows taskbar alongside the tray.">
        <div className="settings-inert-control">
          <Switch checked={true} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Sound effects" hint="Play a shutter sound on capture.">
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
