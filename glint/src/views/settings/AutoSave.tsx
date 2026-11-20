import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

export function AutoSave() {
  const settings = useAppStore((s) => s.settings);
  const setAutoSave = useAppStore((s) => s.setAutoSave);
  const setAutoCopy = useAppStore((s) => s.setAutoCopy);

  return (
    <Section title="Auto-save">
      <Field label="Save captures automatically">
        <Switch
          checked={settings?.auto_save ?? true}
          onChange={(v) => setAutoSave(v)}
        />
      </Field>
      <Field label="Copy captures automatically">
        <Switch
          checked={settings?.auto_copy ?? true}
          onChange={(v) => setAutoCopy(v)}
        />
      </Field>
    </Section>
  );
}
