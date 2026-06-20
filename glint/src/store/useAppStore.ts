import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export type Theme = "dark" | "light" | "system";

export interface Settings {
  theme: Theme;
  accent: string;
  hotkeys: Record<string, string>;
}

export interface Toast {
  id: number;
  text: string;
}

interface AppState {
  settings: Settings | null;
  toasts: Toast[];
  loadSettings: () => Promise<void>;
  setTheme: (t: Theme) => Promise<void>;
  pushToast: (text: string) => void;
  dismissToast: (id: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  settings: null,
  toasts: [],

  loadSettings: async () => {
    const settings = await invoke<Settings>("settings_get_all");
    set({ settings });
    applyTheme(settings.theme);
  },

  setTheme: async (theme: Theme) => {
    const settings = await invoke<Settings>("settings_set", {
      key: "theme",
      value: theme,
    });
    set({ settings });
    applyTheme(theme);
    // Persistence to SQLite handled in Task 11 via ipc.ts saveSetting()
  },

  pushToast: (text: string) =>
    set((s) => ({
      toasts: [...s.toasts, { id: Date.now(), text }],
    })),

  dismissToast: (id: number) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));

/** Resolve "system" → actual dark/light, then stamp onto <html data-theme>. */
function applyTheme(theme: Theme): void {
  const resolved =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}
