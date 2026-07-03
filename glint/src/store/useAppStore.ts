import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { persistSetting, readSetting, saveSetting, setHotkey as setHotkeyIpc, resetHotkeys as resetHotkeysIpc } from "../lib/ipc";
import { registerExplorerMenu, unregisterExplorerMenu } from "../lib/shell";

export type Theme = "dark" | "light" | "system";
export type CursorSize = "off" | "large" | "xl";
export type RecordFxKey =
  | "record_click_viz"
  | "record_keystrokes"
  | "record_cursor_spotlight"
  | "record_cursor_hide"
  | "record_cursor_size";

export interface Settings {
  theme: Theme;
  accent: string;
  hotkeys: Record<string, string>;
  auto_save: boolean;
  auto_copy: boolean;
  open_in_editor: boolean;
  explorer_menu_enabled: boolean;
  record_system_audio: boolean;
  record_microphone: boolean;
  record_webcam: boolean;
  record_click_viz: boolean;
  record_keystrokes: boolean;
  record_cursor_spotlight: boolean;
  record_cursor_hide: boolean;
  record_cursor_size: "off" | "large" | "xl";
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
  setAccent: (hex: string) => Promise<void>;
  setAutoSave: (on: boolean) => Promise<void>;
  setAutoCopy: (on: boolean) => Promise<void>;
  setOpenInEditor: (on: boolean) => Promise<void>;
  setExplorerMenu: (on: boolean) => Promise<void>;
  setRecordSystemAudio: (on: boolean) => Promise<void>;
  setRecordMicrophone: (on: boolean) => Promise<void>;
  setRecordWebcam: (on: boolean) => Promise<void>;
  setRecordFx: (key: RecordFxKey, value: boolean | CursorSize) => Promise<void>;
  setHotkey: (action: string, accelerator: string) => Promise<void>;
  resetHotkeys: () => Promise<void>;
  pushToast: (text: string) => void;
  dismissToast: (id: number) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: null,
  toasts: [],

  loadSettings: async () => {
    // 1. Get Rust defaults (validates shape, provides hotkeys).
    const rustSettings = await invoke<Settings>("settings_get_all");

    // 2. Override persisted keys from SQLite — these are the source of truth
    //    for settings that must survive a full app restart.
    //    Wrapped in try/catch so a missing plugin (plain-Vite preview) doesn't crash.
    let theme = rustSettings.theme;
    let accent = rustSettings.accent;
    let auto_save = rustSettings.auto_save;
    let auto_copy = rustSettings.auto_copy;
    let open_in_editor = rustSettings.open_in_editor;
    let explorer_menu_enabled = rustSettings.explorer_menu_enabled;
    let record_system_audio = rustSettings.record_system_audio;
    let record_microphone = rustSettings.record_microphone;
    let record_webcam = rustSettings.record_webcam;
    try {
      const dbTheme = await readSetting<Theme>("theme");
      if (dbTheme) theme = dbTheme;
      const dbAccent = await readSetting<string>("accent");
      if (dbAccent) accent = dbAccent;
      const dbAutoSave = await readSetting<boolean>("auto_save");
      if (dbAutoSave !== null) auto_save = dbAutoSave;
      const dbAutoCopy = await readSetting<boolean>("auto_copy");
      if (dbAutoCopy !== null) auto_copy = dbAutoCopy;
      const dbOpenInEditor = await readSetting<boolean>("open_in_editor");
      if (dbOpenInEditor !== null) open_in_editor = dbOpenInEditor;
      const dbExplorerMenu = await readSetting<boolean>("explorer_menu_enabled");
      if (dbExplorerMenu !== null) explorer_menu_enabled = dbExplorerMenu;
      const dbRecordSystem = await readSetting<boolean>("record_system_audio");
      if (dbRecordSystem !== null) record_system_audio = dbRecordSystem;
      const dbRecordMic = await readSetting<boolean>("record_microphone");
      if (dbRecordMic !== null) record_microphone = dbRecordMic;
      const dbRecordWebcam = await readSetting<boolean>("record_webcam");
      if (dbRecordWebcam !== null) record_webcam = dbRecordWebcam;
      // Recording FX defaults — override the Rust defaults with persisted values.
      for (const k of ["record_click_viz", "record_keystrokes", "record_cursor_spotlight", "record_cursor_hide"] as const) {
        const v = await readSetting<boolean>(k);
        if (v !== null) rustSettings[k] = v;
      }
      const dbCursorSize = await readSetting<CursorSize>("record_cursor_size");
      if (dbCursorSize !== null) rustSettings.record_cursor_size = dbCursorSize;
    } catch {
      // plugin-sql unavailable (e.g. plain Vite dev server) — use Rust defaults.
    }

    const merged: Settings = { ...rustSettings, theme, accent, auto_save, auto_copy, open_in_editor, explorer_menu_enabled, record_system_audio, record_microphone, record_webcam };
    set({ settings: merged });
    applyTheme(theme);
    applyAccent(accent);
  },

  setTheme: async (theme: Theme) => {
    // a. Keep the Rust live copy validated and in sync for this session.
    const updated = await saveSetting("theme", theme);
    // b. Persist to SQLite so it survives the next restart.
    await persistSetting("theme", theme);
    set({ settings: { ...updated, accent: get().settings?.accent ?? updated.accent } });
    applyTheme(theme);
  },

  setAccent: async (hex: string) => {
    // a. Inform Rust (validation + live copy).
    const updated = await saveSetting("accent", hex);
    // b. Persist to SQLite.
    await persistSetting("accent", hex);
    set({ settings: { ...updated, accent: hex } });
    applyAccent(hex);
  },

  setAutoSave: async (on: boolean) => {
    const updated = await saveSetting("auto_save", on);
    await persistSetting("auto_save", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setAutoCopy: async (on: boolean) => {
    const updated = await saveSetting("auto_copy", on);
    await persistSetting("auto_copy", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setOpenInEditor: async (on: boolean) => {
    const updated = await saveSetting("open_in_editor", on);
    await persistSetting("open_in_editor", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setExplorerMenu: async (on: boolean) => {
    const updated = await saveSetting("explorer_menu_enabled", on);
    await persistSetting("explorer_menu_enabled", on);
    try {
      if (on) await registerExplorerMenu();
      else await unregisterExplorerMenu();
      get().pushToast(on ? "Added to right-click menu" : "Removed from right-click menu");
    } catch {
      get().pushToast("Couldn't update the right-click menu");
    }
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordSystemAudio: async (on: boolean) => {
    const updated = await saveSetting("record_system_audio", on);
    await persistSetting("record_system_audio", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordMicrophone: async (on: boolean) => {
    const updated = await saveSetting("record_microphone", on);
    await persistSetting("record_microphone", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordWebcam: async (on: boolean) => {
    const updated = await saveSetting("record_webcam", on);
    await persistSetting("record_webcam", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordFx: async (key: RecordFxKey, value: boolean | CursorSize) => {
    const updated = await saveSetting(key, value);
    await persistSetting(key, value);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setHotkey: async (action: string, accelerator: string) => {
    // Throws (rejected invoke) on invalid/conflict — the panel catches + shows it.
    const updated = await setHotkeyIpc(action, accelerator);
    await persistSetting("hotkeys", updated.hotkeys);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  resetHotkeys: async () => {
    const updated = await resetHotkeysIpc();
    await persistSetting("hotkeys", updated.hotkeys);
    set({ settings: { ...get().settings, ...updated } as Settings });
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

// ─── Theme helpers ────────────────────────────────────────────────────────────

/** Resolve "system" → actual dark/light, then stamp onto <html data-theme>. */
export function applyTheme(theme: Theme): void {
  const resolved =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
}

// ─── Accent palette + helpers ─────────────────────────────────────────────────
//
// Curated set of 5 restrained accent options. Each triple was chosen for
// legibility on both dark (#0C0D0F) and light (#F6F7F9) backgrounds.
// The hover shade is ~8% lighter; the subtle shade is 12% opacity.
// No freeform picker — the palette keeps the app from ever looking garish.

export interface AccentEntry {
  /** Display name */
  name: string;
  /** Base hex — also the CSS --accent value */
  accent: string;
  /** Slightly lighter variant for hover states */
  hover: string;
  /** Low-opacity wash for backgrounds / selected states */
  subtle: string;
}

export const ACCENT_PALETTE: AccentEntry[] = [
  {
    name: "Periwinkle",
    accent: "#5B7CFA",
    hover: "#6D8BFA",
    subtle: "rgba(91, 124, 250, 0.12)",
  },
  {
    name: "Teal",
    accent: "#2BAAAD",
    hover: "#3DBBBF",
    subtle: "rgba(43, 170, 173, 0.12)",
  },
  {
    name: "Violet",
    accent: "#7C6EFA",
    hover: "#8F83FB",
    subtle: "rgba(124, 110, 250, 0.12)",
  },
  {
    name: "Amber",
    accent: "#D4870A",
    hover: "#E0951A",
    subtle: "rgba(212, 135, 10, 0.12)",
  },
  {
    name: "Rose",
    accent: "#D95F76",
    hover: "#E4708A",
    subtle: "rgba(217, 95, 118, 0.12)",
  },
];

/**
 * Apply an accent hex by finding the closest palette entry and writing
 * --accent / --accent-hover / --accent-subtle onto the root element.
 * Falls back to raw hex with computed variants if not in the palette.
 */
export function applyAccent(hex: string): void {
  const entry = ACCENT_PALETTE.find(
    (e) => e.accent.toLowerCase() === hex.toLowerCase(),
  );
  const root = document.documentElement.style;
  if (entry) {
    root.setProperty("--accent", entry.accent);
    root.setProperty("--accent-hover", entry.hover);
    root.setProperty("--accent-subtle", entry.subtle);
  } else {
    // Unknown hex (e.g. migrated from a future phase's freeform picker):
    // apply it as-is; hover/subtle fall back to their tokens.css defaults.
    root.setProperty("--accent", hex);
  }
}
