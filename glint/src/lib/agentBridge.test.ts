import { describe, expect, it, vi } from "vitest";
import settingsSource from "../../src-tauri/src/settings/mod.rs?raw";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));

import { SETTERS, applySettings } from "./agentBridge";
import { useAppStore, type Settings } from "../store/useAppStore";

/** Fields the Settings page doesn't expose as a plain value. */
const NOT_A_PLAIN_SETTING = new Set(["hotkeys", "auto_name_captures"]);

describe("agent bridge", () => {
  it("covers every native setting field", () => {
    const body = settingsSource.slice(settingsSource.indexOf("pub struct Settings {"));
    const fields = [...body.slice(0, body.indexOf("\n}")).matchAll(/pub (\w+):/g)].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(30);
    const missing = fields.filter((f) => !NOT_A_PLAIN_SETTING.has(f) && !(f in SETTERS));
    expect(missing).toEqual([]);
  });

  it("applies through the store action and reports a rejected value instead of swallowing it", async () => {
    const settings = { theme: "dark", record_fps: 30 } as unknown as Settings;
    const setTheme = vi.fn(async (theme: Settings["theme"]) => {
      useAppStore.setState({ settings: { ...useAppStore.getState().settings!, theme } });
    });
    const setRecordFps = vi.fn(async () => {
      useAppStore.getState().pushToast("Couldn't save Frame rate (record_fps must be 30 or 60)");
    });
    useAppStore.setState({ settings, toasts: [], setTheme, setRecordFps } as never);

    const updated = await applySettings({ theme: "light" });
    expect(setTheme).toHaveBeenCalledWith("light");
    expect(updated.theme).toBe("light");

    await expect(applySettings({ record_fps: 45 })).rejects.toThrow("record_fps must be 30 or 60");
    await expect(applySettings({ nope: true })).rejects.toThrow("Unknown setting: nope");
  });
});
