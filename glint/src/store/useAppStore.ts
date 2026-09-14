import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { persistSetting, saveSetting, setHotkey as setHotkeyIpc, resetHotkeys as resetHotkeysIpc, setSaveDir as setSaveDirIpc, windowSetTaskbar } from "../lib/ipc";
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
  record_resolution: "original" | "1080p" | "720p";
  record_quality: "high" | "medium" | "low";
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
  setRecordResolution: (v: "original" | "1080p" | "720p") => Promise<void>;
  setRecordQuality: (v: "high" | "medium" | "low") => Promise<void>;
  pushToast: (text: string) => void;
  dismissToast: (id: number) => void;
}

export const useAppStore = create<AppState>((set, get) => {
  const settings = () => get().settings;

  // ─── Optimistic write-through ──────────────────────────────────────────
  //
  // Every control in Settings (toggles, dropdowns, accent swatches) is a
  // controlled component driven by `settings`. The setters used to await the
  // Rust invoke + the SQLite persist BEFORE updating local state, so any
  // backend hiccup left the control visibly "stuck" at its old value with no
  // feedback (most call sites fire-and-forget, swallowing the rejection).
  //
  // `commit` flips local state FIRST so controls respond instantly, then syncs
  // to the backend. On failure it rolls back to the previous snapshot and
  // toasts the real error — controls never get stuck silently. It swallows the
  // rejection (after toasting) so fire-and-forget call sites stay safe; the
  // two setters whose callers display their own errors (hotkey rebind,
  // capture-folder pick) use the throwing variants below instead.

  /** Human-readable form of an invoke/DB rejection (usually a plain string). */
  const errText = (e: unknown): string => {
    if (typeof e === "string") return e;
    if (e instanceof Error && e.message) return e.message;
    try {
      const s = JSON.stringify(e);
      return s === undefined ? "unknown error" : s;
    } catch {
      return "unknown error";
    }
  };

  const toastPersistWarning = (label: string, e: unknown): void => {
    get().pushToast(
      `${label} applies for this session, but it may not stick after restart (${errText(e)})`,
    );
  };

  const commit = async <K extends keyof Settings>(
    key: K,
    value: Settings[K],
    label: string,
  ): Promise<void> => {
    const prev = settings();
    if (prev) set({ settings: { ...prev, [key]: value } });
    try {
      const updated = await saveSetting(key, value);
      try {
        await persistSetting(key, value);
      } catch (persistErr) {
        toastPersistWarning(label, persistErr);
      }
      // Merge the authoritative backend copy over current state (not over the
      // stale `prev`) so rapid consecutive changes to different keys can't
      // clobber each other.
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      if (prev) set({ settings: prev });
      get().pushToast(`Couldn't save ${label} (${errText(err)})`);
    }
  };

  return {
  settings: null,
  toasts: [],

  loadSettings: async () => {
    // ONE round-trip. The Rust SettingsState is hydrated from the SQLite `settings`
    // table SYNCHRONOUSLY at startup (settings::hydrate::hydrate_from_db →
    // apply_update, which accepts every persisted key), so `settings_get_all` already
    // carries the persisted values for theme/accent/hotkeys/all toggles.
    const merged = await invoke<Settings>("settings_get_all");
    set({ settings: merged });
    // Stamp the real values + refresh the localStorage mirrors (applyTheme/
    // applyAccent write them), so the next launch starts on the correct colors.
    applyTheme(merged.theme);
    applyAccent(merged.accent);
    // Lift transitions gate cleanly after settings are applied and painted
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.add("ready");
      });
    });
  },

  setTheme: async (theme: Theme) => {
    // Optimistic: re-render + repaint instantly; roll back visuals on failure.
    const prev = settings();
    if (prev) set({ settings: { ...prev, theme } });
    applyTheme(theme);
    try {
      // a. Keep the Rust live copy validated and in sync for this session.
      const updated = await saveSetting("theme", theme);
      // b. Persist to SQLite so it survives the next restart.
      try {
        await persistSetting("theme", theme);
      } catch (persistErr) {
        toastPersistWarning("Theme", persistErr);
      }
      const accent = settings()?.accent ?? updated.accent;
      set({ settings: { ...updated, accent } });
      applyTheme(theme);
      // c. Push the change to every OTHER live window (overlay, HUD, recorder,
      //    editor). localStorage alone won't do it — a running WebView2 never
      //    re-reads it — so we broadcast and each window re-applies (see App.tsx).
      broadcastVisual(theme, accent);
    } catch (err) {
      if (prev) {
        set({ settings: prev });
        applyTheme(prev.theme);
      }
      get().pushToast(`Couldn't save theme (${errText(err)})`);
    }
  },

  setAccent: async (hex: string) => {
    // Optimistic: re-render + repaint instantly; roll back visuals on failure.
    const prev = settings();
    if (prev) set({ settings: { ...prev, accent: hex } });
    applyAccent(hex);
    try {
      // a. Inform Rust (validation + live copy).
      const updated = await saveSetting("accent", hex);
      // b. Persist to SQLite.
      try {
        await persistSetting("accent", hex);
      } catch (persistErr) {
        toastPersistWarning("Accent colour", persistErr);
      }
      const theme = settings()?.theme ?? updated.theme;
      set({ settings: { ...updated, accent: hex } });
      applyAccent(hex);
      // c. Broadcast so already-open windows re-apply the new accent live.
      broadcastVisual(theme, hex);
    } catch (err) {
      if (prev) {
        set({ settings: prev });
        applyAccent(prev.accent);
      }
      get().pushToast(`Couldn't save accent colour (${errText(err)})`);
    }
  },

  setAutoSave: (on: boolean) => commit("auto_save", on, "Auto-save"),

  setAutoCopy: (on: boolean) => commit("auto_copy", on, "Auto-copy"),

  setOpenInEditor: (on: boolean) => commit("open_in_editor", on, "Open in editor"),

  setExplorerMenu: async (on: boolean) => {
    const prev = settings();
    if (prev) set({ settings: { ...prev, explorer_menu_enabled: on } });
    try {
      const updated = await saveSetting("explorer_menu_enabled", on);
      try {
        await persistSetting("explorer_menu_enabled", on);
      } catch (persistErr) {
        toastPersistWarning("Right-click menu setting", persistErr);
      }
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      if (prev) set({ settings: prev });
      get().pushToast(`Couldn't save right-click menu setting (${errText(err)})`);
      return;
    }
    try {
      if (on) await registerExplorerMenu();
      else await unregisterExplorerMenu();
      get().pushToast(on ? "Added to right-click menu" : "Removed from right-click menu");
    } catch {
      get().pushToast("Couldn't update the right-click menu");
    }
  },

  setRecordSystemAudio: (on: boolean) =>
    commit("record_system_audio", on, "System audio"),

  setRecordMicrophone: (on: boolean) =>
    commit("record_microphone", on, "Microphone"),

  setRecordWebcam: (on: boolean) =>
    commit("record_webcam", on, "Webcam"),

  setRecordWebcamMovable: (on: boolean) =>
    commit("record_webcam_movable", on, "Movable webcam"),

  setRecordFx: (key: RecordFxKey, value: boolean | CursorSize) =>
    commit(key, value, "Recording effect"),

  setHotkey: async (action: string, accelerator: string) => {
    // Throws (rejected invoke) on invalid/conflict — the Hotkeys panel catches
    // and shows it inline, so this rolls back WITHOUT toasting (no double
    // feedback). Optimistic so the row responds instantly on success.
    const prev = settings();
    if (prev) {
      set({
        settings: {
          ...prev,
          hotkeys: { ...prev.hotkeys, [action]: accelerator },
        },
      });
    }
    try {
      const updated = await setHotkeyIpc(action, accelerator);
      try {
        await persistSetting("hotkeys", updated.hotkeys);
      } catch (persistErr) {
        toastPersistWarning("Shortcut", persistErr);
      }
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      if (prev) set({ settings: prev });
      throw err;
    }
  },

  resetHotkeys: async () => {
    try {
      const updated = await resetHotkeysIpc();
      try {
        await persistSetting("hotkeys", updated.hotkeys);
      } catch (persistErr) {
        toastPersistWarning("Shortcuts", persistErr);
      }
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      get().pushToast(`Couldn't reset shortcuts (${errText(err)})`);
    }
  },

  setSaveDir: async (path: string) => {
    // Throws on unwritable path — the Storage panel catches and toasts, so
    // roll back WITHOUT toasting here (no double feedback).
    const prev = settings();
    if (prev) set({ settings: { ...prev, save_dir: path } });
    try {
      const updated = await setSaveDirIpc(path); // throws on unwritable
      try {
        await persistSetting("save_dir", path);
      } catch (persistErr) {
        toastPersistWarning("Capture folder", persistErr);
      }
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      if (prev) set({ settings: prev });
      throw err;
    }
  },

  setSoundEffects: (on: boolean) =>
    commit("sound_effects", on, "Sound effects"),

  setShowInTaskbar: async (on: boolean) => {
    const prev = settings();
    if (prev) set({ settings: { ...prev, show_in_taskbar: on } });
    try {
      const updated = await saveSetting("show_in_taskbar", on);
      try {
        await persistSetting("show_in_taskbar", on);
      } catch (persistErr) {
        toastPersistWarning("Taskbar setting", persistErr);
      }
      set({ settings: { ...(settings() ?? {}), ...updated } as Settings });
    } catch (err) {
      if (prev) set({ settings: prev });
      get().pushToast(`Couldn't save taskbar setting (${errText(err)})`);
      return;
    }
    // The taskbar button is a side effect — a failure here must not roll back
    // the (already saved) setting, just surface a toast.
    try {
      await windowSetTaskbar(on);
    } catch {
      get().pushToast("Couldn't update the taskbar button");
    }
  },

  setIncludeCursor: (on: boolean) =>
    commit("include_cursor", on, "Include cursor"),

  setImageFormat: (v: "png" | "jpeg" | "webp") =>
    commit("image_format", v, "Image format"),

  setJpegQuality: (v: "high" | "medium" | "low") =>
    commit("jpeg_quality", v, "JPEG quality"),

  setRecordFps: (v: 30 | 60) =>
    commit("record_fps", v, "Frame rate"),

  setWebcamDevice: (id: string) =>
    commit("webcam_device_id", id, "Camera"),

  setWebcamShape: (shape: "circle" | "rounded" | "square" | "rect") =>
    commit("webcam_shape", shape, "Webcam shape"),

  setCaptureDelay: (v: 3 | 5 | 10) =>
    commit("capture_delay_secs", v, "Capture delay"),

  setRecordResolution: (v: "original" | "1080p" | "720p") =>
    commit("record_resolution", v, "Resolution"),

  setRecordQuality: (v: "high" | "medium" | "low") =>
    commit("record_quality", v, "Recording quality"),

  pushToast: (text: string) =>
    set((s) => ({
      toasts: [...s.toasts, { id: Date.now(), text }],
    })),

  dismissToast: (id: number) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
  };
});

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

/** Resolve "system" → actual dark/light, then stamp onto <html data-theme> and sync --bg. */
export function applyTheme(theme: Theme): void {
  const resolved =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.setProperty(
    "--bg",
    resolved === "light" ? "#F6F7F9" : "#141518",
  );
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* no storage → skip */ }
  // Do not touch .ready here — initial load's ready is managed by index.html/main.tsx/loadSettings
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
 * Always sets all three vars so a switch from e.g. Rose never leaves a
 * stale pink subtle wash behind (the “pink flash” bug).
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
    root.setProperty("--accent", hex);
    try {
      let h = hex.replace("#", "").trim();
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        const hr = Math.min(255, Math.round(r + (255 - r) * 0.12));
        const hg = Math.min(255, Math.round(g + (255 - g) * 0.12));
        const hb = Math.min(255, Math.round(b + (255 - b) * 0.12));
        root.setProperty("--accent-hover", `rgb(${hr}, ${hg}, ${hb})`);
        root.setProperty("--accent-subtle", `rgba(${r}, ${g}, ${b}, 0.12)`);
      }
    } catch { /* ignore */ }
  }
  // Do not touch .ready here — see loadSettings for the pink→green no-flash handling
}
