/**
 * Glint settings utilities.
 * Bridges the store and IPC layer; used by Task 11's settings view.
 */
import type { Theme } from "../store/useAppStore";

/** Apply a resolved theme string to <html data-theme>. */
export function applyThemeClass(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
}

/** Resolve "system" to the OS preference. */
export function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "system") {
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

/** Default settings used before the backend responds. */
export const DEFAULT_SETTINGS = {
  theme: "dark" as Theme,
  accent: "#5B7CFA",
  hotkeys: {} as Record<string, string>,
};
