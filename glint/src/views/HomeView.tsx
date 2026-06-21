import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Crop, AppWindow, Monitor, Video, ImageOff } from "lucide-react";
import { Button, Card, EmptyState } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import "./home.css";

/** Human-readable labels for each hotkey action key. */
const HOTKEY_LABELS: Record<string, string> = {
  capture_area:       "Capture area",
  capture_window:     "Capture window",
  capture_fullscreen: "Capture fullscreen",
  record:             "Record",
  copy_path:          "Copy path",
};

/** Order for display in the hotkeys card. */
const HOTKEY_ORDER = [
  "capture_area",
  "capture_window",
  "capture_fullscreen",
  "record",
  "copy_path",
];

/**
 * Format a raw hotkey string like "CmdOrCtrl+Shift+1" into
 * an array of displayable key chips: ["Ctrl", "Shift", "1"].
 */
function parseHotkey(raw: string): string[] {
  return raw
    .replace(/CmdOrCtrl/g, "Ctrl")
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Command/g, "Cmd")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
}

export default function HomeView() {
  // Atomic selectors: each returns a stable reference. A single selector
  // returning a new object `{...}` re-runs getSnapshot to a fresh value every
  // render, which under Zustand v5's Object.is equality is an infinite loop.
  const settings = useAppStore((s) => s.settings);
  const pushToast = useAppStore((s) => s.pushToast);

  // Listen for tray placeholder actions and surface them as toasts.
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      const action = event.payload;
      const msg: Record<string, string> = {
        cap_area:   "Capture area — lands in Phase 2",
        cap_window: "Capture window — lands in Phase 2",
        cap_full:   "Capture fullscreen — lands in Phase 2",
        record:     "Recording — lands in Phase 2",
      };
      pushToast(msg[action] ?? "Capture lands in Phase 2");
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [pushToast]);

  return (
    <div className="home-view">
      {/* ── Quick-start ─────────────────────────────────────── */}
      <section className="home-section" aria-labelledby="qs-label">
        <span className="label home-section-label" id="qs-label">
          Quick start
        </span>
        <div className="home-quickstart">
          <Button
            variant="primary"
            size="md"
            icon={Crop}
            onClick={() => pushToast("Capture area — lands in Phase 2")}
          >
            Capture Area
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={AppWindow}
            onClick={() => pushToast("Capture window — lands in Phase 2")}
          >
            Capture Window
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={Monitor}
            onClick={() => pushToast("Capture fullscreen — lands in Phase 2")}
          >
            Capture Fullscreen
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={Video}
            onClick={() => pushToast("Recording — lands in Phase 2")}
          >
            Record
          </Button>
        </div>
      </section>

      {/* ── Recent captures ─────────────────────────────────── */}
      <section className="home-section home-section--grow" aria-labelledby="rc-label">
        <span className="label home-section-label" id="rc-label">
          Recent captures
        </span>
        <div className="home-empty-wrap">
          <EmptyState
            icon={ImageOff}
            title="No captures yet"
            hint="Your screenshots and recordings will appear here."
          />
        </div>
      </section>

      {/* ── Hotkeys ─────────────────────────────────────────── */}
      {settings !== null && (
        <section className="home-section" aria-labelledby="hk-label">
          <span className="label home-section-label" id="hk-label">
            Keyboard shortcuts
          </span>
          <Card>
            <ul className="home-hotkeys-list" role="list">
              {HOTKEY_ORDER.map((key) => {
                const raw = settings.hotkeys[key];
                if (!raw) return null;
                const chips = parseHotkey(raw);
                return (
                  <li key={key} className="home-hotkey-row">
                    <span className="home-hotkey-label">
                      {HOTKEY_LABELS[key] ?? key}
                    </span>
                    <span className="home-hotkey-keys" aria-label={raw}>
                      {chips.map((chip, i) => (
                        <kbd key={i} className="home-kbd">
                          {chip}
                        </kbd>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
