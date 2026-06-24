import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { router } from "./router";
import { useAppStore } from "./store/useAppStore";
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
    // Apply dark theme immediately so there's no flash before settings load
    document.documentElement.dataset.theme = "dark";

    // Load persisted settings from the Rust backend
    loadSettings().catch(() => {
      // Backend not ready (e.g., running plain Vite without Tauri).
      // Fall back to dark theme — already applied above.
    });
  }, [loadSettings]);

  useEffect(() => {
    // Cold start via "Open in Glint": Rust set the external image into EditorState
    // and a one-shot pending flag before this webview mounted. Consume it and
    // navigate; EditorView's mount fetch then loads the image.
    consumePendingExternalOpen()
      .then((pending) => {
        if (pending) router.navigate("/editor");
      })
      .catch(() => {
        // Backend not ready (plain Vite) — nothing to open.
      });
  }, []);

  useEffect(() => {
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
      // This listener must stay mounted for the editor to open — it does because
      // the main window is only ever hidden, never destroyed (see lib.rs
      // CloseRequested → hide), so this App tree is never torn down.
      listen("editor-open", () => {
        router.navigate("/editor");
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
