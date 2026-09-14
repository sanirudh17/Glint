import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Settings } from "./useAppStore";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emit: vi.fn() }));

const saveSettingMock = vi.fn();
const persistSettingMock = vi.fn();

vi.mock("../lib/ipc", () => ({
  // saveSetting mock applies the key/value onto a copy of the passed-through
  // base by default; individual tests override the implementation.
  saveSetting: (...args: unknown[]) => saveSettingMock(...args),
  persistSetting: (...args: unknown[]) => persistSettingMock(...args),
  setHotkey: vi.fn(),
  resetHotkeys: vi.fn(),
  setSaveDir: vi.fn(),
  windowSetTaskbar: vi.fn(),
}));

vi.mock("../lib/shell", () => ({
  registerExplorerMenu: vi.fn(),
  unregisterExplorerMenu: vi.fn(),
}));

import { useAppStore } from "./useAppStore";

function seed(overrides: Partial<Settings> = {}): Settings {
  return {
    theme: "dark",
    accent: "#2BAAAD",
    hotkeys: {},
    auto_save: true,
    auto_copy: true,
    open_in_editor: false,
    explorer_menu_enabled: true,
    record_system_audio: true,
    record_microphone: false,
    record_webcam: false,
    record_webcam_movable: false,
    record_click_viz: false,
    record_keystrokes: false,
    record_cursor_spotlight: false,
    record_cursor_hide: false,
    record_cursor_size: "off",
    save_dir: "",
    sound_effects: false,
    show_in_taskbar: true,
    include_cursor: false,
    image_format: "png",
    jpeg_quality: "high",
    record_fps: 60,
    webcam_device_id: "",
    webcam_shape: "circle",
    capture_delay_secs: 5,
    record_resolution: "original",
    record_quality: "high",
    ...overrides,
  } as Settings;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({ settings: seed(), toasts: [] });
  // Default: backend echoes the change onto a clone of current settings.
  saveSettingMock.mockImplementation(async (key: string, value: unknown) => ({
    ...useAppStore.getState().settings,
    [key]: value,
  }));
  persistSettingMock.mockResolvedValue(undefined);
});

describe("settings optimistic write-through", () => {
  it("applies a toggle instantly and keeps it after backend success", async () => {
    const p = useAppStore.getState().setAutoSave(false);
    // Optimistic: visible before the invoke round-trip resolves.
    expect(useAppStore.getState().settings?.auto_save).toBe(false);
    await p;
    expect(useAppStore.getState().settings?.auto_save).toBe(false);
    expect(saveSettingMock).toHaveBeenCalledWith("auto_save", false);
    expect(persistSettingMock).toHaveBeenCalledWith("auto_save", false);
    expect(useAppStore.getState().toasts).toHaveLength(0);
  });

  it("rolls back and toasts when the backend rejects (never stuck)", async () => {
    saveSettingMock.mockRejectedValue("boom");
    await useAppStore.getState().setAutoSave(false);
    // Rolled back to the pre-click value…
    expect(useAppStore.getState().settings?.auto_save).toBe(true);
    // …with a visible error instead of a silently stuck toggle.
    const texts = useAppStore.getState().toasts.map((t) => t.text);
    expect(texts.some((t) => t.includes("Auto-save") && t.includes("boom"))).toBe(true);
  });

  it("keeps the change but warns when only SQLite persist fails", async () => {
    persistSettingMock.mockRejectedValue("db locked");
    await useAppStore.getState().setImageFormat("jpeg");
    expect(useAppStore.getState().settings?.image_format).toBe("jpeg");
    const texts = useAppStore.getState().toasts.map((t) => t.text);
    expect(texts.some((t) => t.includes("Image format") && t.includes("db locked"))).toBe(true);
  });
});
