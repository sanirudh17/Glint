import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
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

  // Boot veil: render NOTHING until settings (theme + accent) are hydrated from
  // the DB. This is the hard guarantee against the pink→green flash: the stale
  // localStorage mirror may hold an old accent, so any UI rendered before the DB
  // read completes can flash the wrong color. A dark veil matching the window
  // background is indistinguishable from the not-yet-painted window, and the first
  // real frame the user sees is already styled with the correct accent. The veil
  // lifts on hydration OR after a short cap (plain-Vite dev without the backend).
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setBooted(true);
      }
    };
    // Cap: never block boot more than 400ms (backend missing / slow disk).
    const cap = window.setTimeout(finish, 400);
    loadSettings()
      .catch(() => {
        // Backend not ready (e.g., running plain Vite without Tauri) — the cap
        // lifts the veil and main.tsx's pre-paint fallback theme applies.
      })
      .finally(() => {
        window.clearTimeout(cap);
        finish();
      });
    return () => window.clearTimeout(cap);
  }, [loadSettings]);

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

  if (!booted) {
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
