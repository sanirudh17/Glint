import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

/** Human-readable labels matching HomeView constants. */
const HOTKEY_LABELS: Record<string, string> = {
  capture_area:       "Capture area",
  capture_window:     "Capture window",
  capture_fullscreen: "Capture fullscreen",
  record:             "Record",
  copy_path:          "Copy path",
};

const HOTKEY_ORDER = [
  "capture_area",
  "capture_window",
  "capture_fullscreen",
  "record",
  "copy_path",
];

function parseHotkey(raw: string): string[] {
  return raw
    .replace(/CmdOrCtrl/g, "Ctrl")
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Command/g, "Cmd")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
}

export function Hotkeys() {
  const settings = useAppStore((s) => s.settings);
  if (!settings) return null;

  return (
    <Section
      title="Keyboard shortcuts"
      description="Global shortcuts registered with the OS. Reconfiguring shortcuts is available in a later phase."
    >
      <Card>
        <ul className="settings-hotkeys-list" role="list">
          {HOTKEY_ORDER.map((key) => {
            const raw = settings.hotkeys[key];
            if (!raw) return null;
            const chips = parseHotkey(raw);
            return (
              <li key={key} className="settings-hotkey-row">
                <span className="settings-hotkey-label">
                  {HOTKEY_LABELS[key] ?? key}
                </span>
                <span className="settings-hotkey-keys" aria-label={raw}>
                  {chips.map((chip, i) => (
                    <kbd key={i} className="settings-kbd">
                      {chip}
                    </kbd>
                  ))}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </Section>
  );
}
