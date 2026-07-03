import { useEffect, useState } from "react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { autostartGet, autostartSet } from "../../lib/ipc";

export function General() {
  const settings = useAppStore((s) => s.settings);
  const setExplorerMenu = useAppStore((s) => s.setExplorerMenu);
  const setShowInTaskbar = useAppStore((s) => s.setShowInTaskbar);
  const setSoundEffects = useAppStore((s) => s.setSoundEffects);
  const pushToast = useAppStore((s) => s.pushToast);

  const [autostart, setAutostart] = useState(false);
  useEffect(() => { autostartGet().then(setAutostart).catch(() => {}); }, []);

  async function toggleAutostart(on: boolean) {
    try {
      await autostartSet(on);
      setAutostart(on);
      pushToast(on ? "Glint will launch at login" : "Launch at login disabled");
    } catch {
      pushToast("Couldn't update launch at login");
      autostartGet().then(setAutostart).catch(() => {});
    }
  }

  return (
    <Section title="General" description="App-wide behaviour settings.">
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
        <Switch checked={autostart} onChange={(v) => void toggleAutostart(v)} />
      </Field>
      <Field label="Show in taskbar" hint="Keep Glint's main window visible in the Windows taskbar alongside the tray.">
        <Switch checked={settings?.show_in_taskbar ?? true} onChange={(v) => void setShowInTaskbar(v)} />
      </Field>
      <Field label="Sound effects" hint="Play a shutter sound on capture.">
        <Switch checked={settings?.sound_effects ?? false} onChange={(v) => void setSoundEffects(v)} />
      </Field>
    </Section>
  );
}
