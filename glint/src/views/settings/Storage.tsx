import { useEffect, useState } from "react";
import { HardDrive, FolderOpen, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Section, Field, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { storagePaths, revealPath, type StoragePaths } from "../../lib/ipc";

export function Storage() {
  const settings = useAppStore((s) => s.settings);
  const setSaveDir = useAppStore((s) => s.setSaveDir);
  const pushToast = useAppStore((s) => s.pushToast);
  const [paths, setPaths] = useState<StoragePaths | null>(null);

  const refresh = () => storagePaths().then(setPaths).catch(() => setPaths(null));
  useEffect(() => { refresh(); }, [settings?.save_dir]);

  async function choose() {
    const dir = await open({ directory: true, multiple: false, title: "Choose capture folder" });
    if (typeof dir === "string") {
      try {
        await setSaveDir(dir);
        pushToast("Capture folder updated");
      } catch (e) {
        pushToast(String(e));
      }
    }
  }

  async function resetDefault() {
    try {
      await setSaveDir("");
      pushToast("Reverted to the default folder");
    } catch (e) {
      pushToast(String(e));
    }
  }

  const custom = (settings?.save_dir ?? "") !== "";

  return (
    <Section title="Storage" description="Where Glint stores your data on disk.">
      <Card>
        <div className="settings-storage-list">
          {([
            ["Screenshots", paths?.screenshots],
            ["Recordings", paths?.recordings],
            ["Database", paths?.database],
            ["Logs", paths?.logs],
          ] as const).map(([label, value]) => (
            <div className="settings-storage-row" key={label}>
              <span className="settings-storage-key">
                <HardDrive size={13} strokeWidth={1.75} />
                {label}
              </span>
              <code className="settings-storage-path">{value ?? "…"}</code>
            </div>
          ))}
        </div>
      </Card>

      <Field label="Capture folder" hint="Where new screenshots and recordings are saved. Existing files aren't moved.">
        <div className="settings-folder-control">
          <code className="settings-folder-path">{paths?.screenshots ?? "…"}</code>
          <div className="settings-folder-actions">
            <button type="button" className="settings-hotkey-btn" onClick={() => void choose()}>
              <FolderOpen size={13} strokeWidth={1.75} /> Choose…
            </button>
            <button
              type="button"
              className="settings-hotkey-btn"
              onClick={() => paths && void revealPath(paths.screenshots)}
            >
              Reveal
            </button>
            {custom && (
              <button
                type="button"
                className="settings-hotkey-btn settings-hotkey-btn--ghost"
                onClick={() => void resetDefault()}
              >
                <RotateCcw size={13} strokeWidth={1.75} /> Reset
              </button>
            )}
          </div>
        </div>
      </Field>
    </Section>
  );
}
