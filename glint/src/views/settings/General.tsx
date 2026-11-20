import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Section, Field, Switch, Select, Button } from "../../components/ui";
import { Volume2 } from "../../icons";
import { useAppStore, SHUTTER_SOUNDS, type ShutterSound } from "../../store/useAppStore";
import { autostartGet, autostartSet } from "../../lib/ipc";

export function General() {
  const settings = useAppStore((s) => s.settings);
  const setExplorerMenu = useAppStore((s) => s.setExplorerMenu);
  const setShowInTaskbar = useAppStore((s) => s.setShowInTaskbar);
  const setSoundEffects = useAppStore((s) => s.setSoundEffects);
  const setShutterSound = useAppStore((s) => s.setShutterSound);
  const preview = (id: string) => void invoke("sound_preview", { id }).catch((e) => pushToast(String(e)));
  const pushToast = useAppStore((s) => s.pushToast);

  const [autostart, setAutostart] = useState(false);
  useEffect(() => { autostartGet().then(setAutostart).catch(() => {}); }, []);
  // Open the audio device now so a sound preview plays the moment it is chosen.
  useEffect(() => { void invoke("sound_warm").catch(() => {}); }, []);

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
    <Section title="General">
      <Field label="Launch at login">
        <Switch checked={autostart} onChange={(v) => void toggleAutostart(v)} />
      </Field>
      <Field label="Show in taskbar">
        <Switch checked={settings?.show_in_taskbar ?? true} onChange={(v) => void setShowInTaskbar(v)} />
      </Field>
      <Field label="“Open in Glint” in Explorer">
        <Switch
          checked={settings?.explorer_menu_enabled ?? true}
          onChange={(v) => setExplorerMenu(v)}
        />
      </Field>
      <Field label="Shutter sound">
        <span className="settings-sound-control">
          <Select
            ariaLabel="Shutter sound"
            value={settings?.shutter_sound ?? "click"}
            options={[...SHUTTER_SOUNDS]}
            onChange={(v) => { void setShutterSound(v as ShutterSound); preview(v); }}
          />
          <Button size="sm" variant="ghost" icon={Volume2} aria-label="Play shutter sound" title="Play" onClick={() => preview(settings?.shutter_sound ?? "click")} />
          <Switch ariaLabel="Play shutter sound on capture" checked={settings?.sound_effects ?? false} onChange={(v) => void setSoundEffects(v)} />
        </span>
      </Field>
    </Section>
  );
}
