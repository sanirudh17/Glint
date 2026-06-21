import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { router } from "./router";
import { useAppStore } from "./store/useAppStore";
import { ToastHost } from "./components/ui";

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
    // Listen for global shortcut events emitted by the Rust backend.
    // The payload is the action name (e.g. "capture_area").
    // Returns an unlisten function; call it on cleanup to avoid leaks.
    const unlisten = listen<string>("shortcut-fired", (e) => {
      pushToast(`Hotkey: ${e.payload}`);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [pushToast]);

  return (
    <>
      <RouterProvider router={router} />
      <ToastHost />
    </>
  );
}
