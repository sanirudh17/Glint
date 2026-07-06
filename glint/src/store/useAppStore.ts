import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { persistSetting, readSetting, saveSetting, setHotkey as setHotkeyIpc, resetHotkeys as resetHotkeysIpc, setSaveDir as setSaveDirIpc, windowSetTaskbar } from "../lib/ipc";
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
  record_webcam_movable: boolean;
  record_click_viz: boolean;
  record_keystrokes: boolean;
  record_cursor_spotlight: boolean;
  record_cursor_hide: boolean;
  record_cursor_size: "off" | "large" | "xl";
  save_dir: string;
  sound_effects: boolean;
  show_in_taskbar: boolean;
  include_cursor: boolean;
  image_format: "png" | "jpeg" | "webp";
  jpeg_quality: "high" | "medium" | "low";
  record_fps: 30 | 60;
  webcam_device_id: string;
  webcam_shape: "circle" | "rounded" | "square" | "rect";
  capture_delay_secs: 3 | 5 | 10;
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
  setRecordWebcamMovable: (on: boolean) => Promise<void>;
  setRecordFx: (key: RecordFxKey, value: boolean | CursorSize) => Promise<void>;
  setHotkey: (action: string, accelerator: string) => Promise<void>;
  resetHotkeys: () => Promise<void>;
  setSaveDir: (path: string) => Promise<void>;
  setSoundEffects: (on: boolean) => Promise<void>;
  setShowInTaskbar: (on: boolean) => Promise<void>;
  setIncludeCursor: (on: boolean) => Promise<void>;
  setImageFormat: (v: "png" | "jpeg" | "webp") => Promise<void>;
  setJpegQuality: (v: "high" | "medium" | "low") => Promise<void>;
  setRecordFps: (v: 30 | 60) => Promise<void>;
  setWebcamDevice: (id: string) => Promise<void>;
  setWebcamShape: (shape: "circle" | "rounded" | "square" | "rect") => Promise<void>;
  setCaptureDelay: (v: 3 | 5 | 10) => Promise<void>;
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
      const dbWebcamShape = await readSetting<Settings["webcam_shape"]>("webcam_shape");
      if (dbWebcamShape) rustSettings.webcam_shape = dbWebcamShape;
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
    const accent = get().settings?.accent ?? updated.accent;
    set({ settings: { ...updated, accent } });
    applyTheme(theme);
    // c. Push the change to every OTHER live window (overlay, HUD, recorder,
    //    editor). localStorage alone won't do it — a running WebView2 never
    //    re-reads it — so we broadcast and each window re-applies (see App.tsx).
    broadcastVisual(theme, accent);
  },

  setAccent: async (hex: string) => {
    // a. Inform Rust (validation + live copy).
    const updated = await saveSetting("accent", hex);
    // b. Persist to SQLite.
    await persistSetting("accent", hex);
    const theme = get().settings?.theme ?? updated.theme;
    set({ settings: { ...updated, accent: hex } });
    applyAccent(hex);
    // c. Broadcast so already-open windows re-apply the new accent live.
    broadcastVisual(theme, hex);
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

  setRecordWebcamMovable: async (on: boolean) => {
    const updated = await saveSetting("record_webcam_movable", on);
    await persistSetting("record_webcam_movable", on);
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

  setSaveDir: async (path: string) => {
    const updated = await setSaveDirIpc(path); // throws on unwritable
    await persistSetting("save_dir", path);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setSoundEffects: async (on: boolean) => {
    const updated = await saveSetting("sound_effects", on);
    await persistSetting("sound_effects", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setShowInTaskbar: async (on: boolean) => {
    const updated = await saveSetting("show_in_taskbar", on);
    await persistSetting("show_in_taskbar", on);
    await windowSetTaskbar(on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setIncludeCursor: async (on: boolean) => {
    const updated = await saveSetting("include_cursor", on);
    await persistSetting("include_cursor", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setImageFormat: async (v: "png" | "jpeg" | "webp") => {
    const updated = await saveSetting("image_format", v);
    await persistSetting("image_format", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setJpegQuality: async (v: "high" | "medium" | "low") => {
    const updated = await saveSetting("jpeg_quality", v);
    await persistSetting("jpeg_quality", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setRecordFps: async (v: 30 | 60) => {
    const updated = await saveSetting("record_fps", v);
    await persistSetting("record_fps", v);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setWebcamDevice: async (id: string) => {
    const updated = await saveSetting("webcam_device_id", id);
    await persistSetting("webcam_device_id", id);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setWebcamShape: async (shape: "circle" | "rounded" | "square" | "rect") => {
    const updated = await saveSetting("webcam_shape", shape);
    await persistSetting("webcam_shape", shape);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  setCaptureDelay: async (v: 3 | 5 | 10) => {
    const updated = await saveSetting("capture_delay_secs", v);
    await persistSetting("capture_delay_secs", v);
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

// Persisted mirrors of the two visual settings, written on every apply. main.tsx
// reads these SYNCHRONOUSLY before React's first paint so the app boots straight to
// the user's theme + accent — no flash of the tokens.css default while loadSettings()
// does its async SQLite round-trip. localStorage is shared across every Glint window
// (one origin), so the HUD / overlay / selector all benefit too.
export const THEME_STORAGE_KEY = "glint.theme";
export const ACCENT_STORAGE_KEY = "glint.accent";

// Broadcast so every OTHER Glint window re-applies theme/accent the instant they
// change — the overlay, HUD, recorder and editor webviews are long-lived (some
// pre-warmed at startup) and won't pick up a new value from the shared
// localStorage on their own. App.tsx listens for this in every window.
export const VISUAL_SETTINGS_EVENT = "settings-visual-changed";
export interface VisualSettings {
  theme: Theme;
  accent: string;
}

/** Fire-and-forget broadcast of the current theme+accent to all windows (incl.
 *  self — re-applying is idempotent). No-op if not running under Tauri. */
function broadcastVisual(theme: Theme, accent: string): void {
  void emit(VISUAL_SETTINGS_EVENT, { theme, accent } satisfies VisualSettings).catch(() => {
    /* not in a Tauri window (plain Vite) — nothing to broadcast */
  });
}

/** Resolve "system" → actual dark/light, then stamp onto <html data-theme>. */
export function applyTheme(theme: Theme): void {
  const resolved =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* no storage → skip */ }
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
  try { localStorage.setItem(ACCENT_STORAGE_KEY, hex); } catch { /* no storage → skip */ }
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
