import { describe as group, expect, it } from "vitest";
import { describe, ago, statusOf, type ActivityEntry, type AgentStatus } from "./agentActivity";

const entry = (tool: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ t: 0, agent: "claude-code", client: "claude-code", tool, ok: true, ...extra });

group("agent activity", () => {
  it("reads as plain sentences with the file emphasised separately", () => {
    expect(describe(entry("video_export", { target: "demo (Studio).mp4" }))).toEqual({ text: "Exported", target: "demo (Studio).mp4", failed: false });
    expect(describe(entry("video_export", { state: "running", target: "demo.mp4" })).text).toBe("Started exporting");
    expect(describe(entry("settings_set", { detail: { theme: "light" } })).text).toBe("Switched to the Light theme");
    expect(describe(entry("settings_set", { detail: { auto_copy: false } })).text).toBe("Turned off auto copy");
    expect(describe(entry("settings_set", { detail: { record_fps: 60 } })).text).toBe("Set recording fps to 60");
    expect(describe(entry("hotkey_set", { detail: { action: "capture_area", accelerator: "Ctrl+Shift+2" } })).text).toBe("Set the Capture area shortcut to Ctrl+Shift+2");
    expect(describe(entry("capture_screenshot", { detail: { mode: "fullscreen" } })).text).toBe("Took a fullscreen screenshot");
    expect(describe(entry("recording_control", { detail: { action: "cancel" } })).text).toBe("Discarded the recording");
    expect(describe(entry("image_trim", { ok: false, target: "a.png" }))).toEqual({ text: "Trimmed", target: "a.png", failed: true });
  });

  it("tells an agent's state at a glance", () => {
    const now = Date.UTC(2026, 10, 21, 12);
    const base: AgentStatus = { id: "codex", name: "Codex", installed: true, configured: false, active: false, last_used: null };
    expect(statusOf({ ...base, active: true }, now)).toEqual({ label: "Active now", tone: "live" });
    expect(statusOf({ ...base, configured: true, last_used: now - 3 * 3600_000 }, now).label).toBe("Last used 3 h ago");
    expect(statusOf({ ...base, configured: true }, now).label).toBe("Connected, not used yet");
    expect(statusOf(base, now)).toEqual({ label: "Not connected", tone: "off" });
    expect(ago(now - 20_000, now)).toBe("Just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5 min ago");
  });
});
