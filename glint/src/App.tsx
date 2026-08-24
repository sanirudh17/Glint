import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { router } from "./router";
import {
  useAppStore,
  applyTheme,
  applyAccent,
  VISUAL_SETTINGS_EVENT,
  type VisualSettings,
} from "./store/useAppStore";
import { ToastHost } from "./components/ui";
import { UpdateGate } from "./update/UpdateGate";

/** Payload of the `capture-complete` event emitted by tray-core after a crop. */
type CaptureComplete = {
  path: string;
  width: number;
  height: number;
  clipboard: boolean;
};

/**
 * App — root component.
 *
 * Bootstraps the theme on mount (calls Rust settings_get_all, stamps
 * data-theme onto <html>), then hands off to the router.
 *
 * The annotation editor is NOT reached from here — it lives in its own OS window
 * (label "editor", route #/editor, built by editor::window), so this window never
 * navigates to /editor. That's why there's no `editor-open` navigation below: the
 * editor window loads #/editor directly and its EditorView fetches the source on
 * mount (and reloads on `editor-open` for a reopen).
 */
export default function App() {
  const loadSettings = useAppStore((s) => s.loadSettings);
  const pushToast = useAppStore((s) => s.pushToast);
  const settings = useAppStore((s) => s.settings);

  // Boot veil: render NOTHING until settings (theme + accent) are ACTUALLY hydrated
  // — gated on the store value, not a timer. This is the hard guarantee against the
  // pink→green flash: the localStorage mirror can hold a stale accent, and any UI
  // painted before the DB read completes flashes that stale color first. The dark
  // veil is indistinguishable from the not-yet-painted window; the first real frame
  // already carries the correct accent. The cap exists ONLY for environments with
  // no backend at all (plain-Vite dev): it must be generous, because a cold SQLite
  // open can legitimately take several hundred ms — lifting early is exactly what
  // caused the flash this gate exists to prevent.
  const [capExpired, setCapExpired] = useState(false);

  useEffect(() => {
    const cap = window.setTimeout(() => setCapExpired(true), 2500);
    loadSettings().catch(() => {
      /* backend missing (plain Vite) — the cap lifts the veil */
    });
    return () => window.clearTimeout(cap);
  }, [loadSettings]);

  // Reveal handshake: once settings are hydrated and the first REAL frame has
  // painted (double-rAF), tell Rust to show the main window. Until then the
  // window stays invisible, so the user never sees an empty/black boot frame —
  // the app pops in fully rendered with the correct theme + accent. Other
  // windows (editor/trim/hud/overlay) mount this same component but must NOT
  // trigger the main window's reveal.
  useEffect(() => {
    if (!settings && !capExpired) return;
    let cancelled = false;
    const r = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          if (getCurrentWindow().label === "main") {
            void emit("main-ready").catch(() => {});
          }
        } catch {
          /* not running under Tauri (plain Vite) */
        }
      }),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(r);
    };
  }, [settings, capExpired]);

  useEffect(() => {
    // Backend events → toasts. Each listen() returns an unlisten promise;
    // collect them all and tear down on cleanup to avoid leaks. These are fine in
    // EVERY window (main, HUD, overlay, editor) — e.g. glint-toast must reach the
    // HUD's ToastHost for the copy-path hotkey.
    const subs = [
      // Global shortcut events for the non-capture actions (record/settings).
      // Capture hotkeys go straight to capture::begin in Rust and do NOT emit
      // shortcut-fired, so they never reach this toast.
      listen<string>("shortcut-fired", (e) => {
        pushToast(`Hotkey: ${e.payload}`);
      }),

      // A capture finished: cropped PNG written + (usually) copied to clipboard.
      listen<CaptureComplete>("capture-complete", (e) => {
        const { width, height, clipboard } = e.payload;
        pushToast(
          clipboard
            ? `Copied to clipboard · ${width}×${height}`
            : `Saved · ${width}×${height} (clipboard unavailable)`,
        );
      }),

      // Generic backend toast (e.g. capture errors surfaced from tray-core).
      listen<string>("glint-toast", (e) => {
        pushToast(e.payload);
      }),

      // Theme/accent changed in Settings — re-apply in THIS window too. Runs in
      // EVERY window (not main-only): the whole point is that the long-lived
      // overlay / HUD / recorder / editor webviews update their colors live
      // instead of keeping the accent they were built with. Idempotent, so the
      // window that emitted it re-applying is harmless.
      listen<VisualSettings>(VISUAL_SETTINGS_EVENT, (e) => {
        applyTheme(e.payload.theme);
        applyAccent(e.payload.accent);
      }),
    ];

    return () => {
      subs.forEach((p) => p.then((fn) => fn()));
    };
  }, [pushToast]);

  if (!settings && !capExpired) {
    return <div className="boot-veil" aria-hidden="true" />;
  }

  return (
    <>
      <RouterProvider router={router} />
      <ToastHost />
      <UpdateGate />
    </>
  );
}
