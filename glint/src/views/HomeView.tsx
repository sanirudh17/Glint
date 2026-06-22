import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Crop, AppWindow, Monitor, Video, ImageOff } from "lucide-react";
import { Button, Card, EmptyState } from "../components/ui";
import { useAppStore } from "../store/useAppStore";
import { startCapture } from "../lib/captureIpc";
import { listCaptures, type CaptureItem } from "../lib/captures";
import { CaptureCard } from "./library/CaptureCard";
import "./home.css";

/** How many of the most recent captures the dashboard previews. */
const RECENT_LIMIT = 6;

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

  // Recent-captures preview — newest first, capped at RECENT_LIMIT.
  const [recent, setRecent] = useState<CaptureItem[]>([]);
  const reloadRecent = useCallback(() => {
    listCaptures()
      .then((c) => setRecent(c.slice(0, RECENT_LIMIT)))
      .catch(() => setRecent([]));
  }, []);
  useEffect(() => { reloadRecent(); }, [reloadRecent]);
  // Refresh when a capture is saved (or deleted from a card here / in the Library).
  useEffect(() => {
    const p = listen("capture-saved", () => reloadRecent());
    return () => { p.then((un) => un()); };
  }, [reloadRecent]);

  // The tray's capture items call capture::begin directly now; only the
  // not-yet-built actions still emit "tray-action" (e.g. record → Phase 6).
  useEffect(() => {
    const unlisten = listen<string>("tray-action", (event) => {
      const msg: Record<string, string> = {
        record: "Recording arrives in a later phase",
      };
      pushToast(msg[event.payload] ?? "That action arrives in a later phase");
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
            onClick={() => startCapture("area")}
          >
            Capture Area
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={AppWindow}
            onClick={() => startCapture("window")}
          >
            Capture Window
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={Monitor}
            onClick={() => startCapture("fullscreen")}
          >
            Capture Fullscreen
          </Button>
          <Button
            variant="subtle"
            size="md"
            icon={Video}
            onClick={() => pushToast("Recording arrives in a later phase")}
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
        {recent.length === 0 ? (
          <div className="home-empty-wrap">
            <EmptyState
              icon={ImageOff}
              title="No captures yet"
              hint="Your screenshots and recordings will appear here."
            />
          </div>
        ) : (
          <div className="home-recent-grid" role="list" aria-label="Recent captures">
            {recent.map((c) => (
              <CaptureCard key={c.id} item={c} onChanged={reloadRecent} />
            ))}
          </div>
        )}
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
