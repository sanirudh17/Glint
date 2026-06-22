import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

export function AutoSave() {
  const settings = useAppStore((s) => s.settings);
  const setAutoSave = useAppStore((s) => s.setAutoSave);
  const setAutoCopy = useAppStore((s) => s.setAutoCopy);

  return (
    <Section
      title="Auto-save"
      description="Automatically save captures to disk after taking them."
    >
      <Field label="Auto-save captures" hint="Save each capture to Pictures\Glint without prompting.">
        <Switch
          checked={settings?.auto_save ?? true}
          onChange={(v) => setAutoSave(v)}
        />
      </Field>
      <Field label="Auto-copy to clipboard" hint="Copy the capture to the clipboard immediately after taking it.">
        <Switch
          checked={settings?.auto_copy ?? true}
          onChange={(v) => setAutoCopy(v)}
        />
      </Field>
      <Field label="Open in editor after capture" hint="Open each capture in the editor view automatically.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in Phase 5
          </span>
        </div>
      </Field>
    </Section>
  );
}
