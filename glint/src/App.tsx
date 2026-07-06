import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
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
import { consumePendingExternalOpen } from "./lib/shell";

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
 * No greet() demo, no network calls.
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
    // Cold start via "Open in Glint": Rust set the external image into EditorState
    // and a one-shot pending flag before this webview mounted. Consume it and
    // navigate; EditorView's mount fetch then loads the image.
    //
    // Guard to the MAIN window only. Every window (main, HUD, overlay) mounts the
    // same <App/>, and PendingOpen is one global flag — without this guard a
    // pre-warmed overlay/HUD webview could consume the flag and navigate ITSELF
    // to /editor (showing a fullscreen annotator on the next capture). Only the
    // main window owns the editor route.
    let isMain = false;
    try {
      isMain = getCurrentWindow().label === "main";
    } catch {
      isMain = false; // not in a Tauri window (plain Vite) — nothing to open.
    }
    if (!isMain) return;
    consumePendingExternalOpen()
      .then((pending) => {
        if (pending) router.navigate("/editor");
      })
      .catch(() => {
        // Backend not ready (plain Vite) — nothing to open.
      });
  }, []);

  useEffect(() => {
    // Are we the main window? Every window (main, HUD `#/hud`, overlay `#/overlay`)
    // loads the same index.html and mounts this same <App/> — they differ only by
    // hash route. Tauri's listen() receives an event emitted to ANY target, so a
    // listener registered here is live in EVERY window regardless of emit/emit_to.
    // Anything that navigates the router must therefore run ONLY in the main
    // window; otherwise the HUD turns into a mini-annotator and the pre-warmed
    // overlay navigates to /editor (next capture shows a stuck fullscreen
    // annotator). Toasts are fine in any window (e.g. glint-toast must reach the
    // HUD's ToastHost for the copy-path hotkey).
    let isMain = false;
    try {
      isMain = getCurrentWindow().label === "main";
    } catch {
      isMain = false;
    }

    // Backend events → toasts. Each listen() returns an unlisten promise;
    // collect them all and tear down on cleanup to avoid leaks.
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

      // Editor entry points (HUD Annotate / Library Edit / open-in-editor) emit this.
      // MAIN WINDOW ONLY — see the isMain note above: navigating any other window
      // to /editor is exactly the window-hijack bug. The main window is only ever
      // hidden, never destroyed (lib.rs CloseRequested → hide), so this listener
      // stays mounted for the whole session.
      listen("editor-open", () => {
        if (isMain) router.navigate("/editor");
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
