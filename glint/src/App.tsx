import { useEffect } from "react";
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

  useEffect(() => {
    // Theme + accent were already applied synchronously in main.tsx (from the
    // localStorage mirror) before first paint — no flash. Just hydrate the full
    // settings from the backend, which re-applies the same theme/accent from the DB.
    loadSettings().catch(() => {
      // Backend not ready (e.g., running plain Vite without Tauri) — main.tsx's
      // pre-paint fallback already stamped a theme, so there's nothing more to do.
    });
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

  return (
    <>
      <RouterProvider router={router} />
      <ToastHost />
    </>
  );
}
