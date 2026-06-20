import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useAppStore } from "./store/useAppStore";

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

  useEffect(() => {
    // Apply dark theme immediately so there's no flash before settings load
    document.documentElement.dataset.theme = "dark";

    // Load persisted settings from the Rust backend
    loadSettings().catch(() => {
      // Backend not ready (e.g., running plain Vite without Tauri).
      // Fall back to dark theme — already applied above.
    });
  }, [loadSettings]);

  return <RouterProvider router={router} />;
}
