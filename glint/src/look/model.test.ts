import { describe, expect, it } from "vitest";
import { cloneLook, DEFAULT_LOOK, hydrateLook } from "./model";
import { parsePresets } from "./presets";
import { computeLayout } from "../editor/composition";
describe("shared looks", () => {
  it("hydrates legacy frames and preserves screenshot chrome", () => {
    expect(hydrateLook({ padding: 12 })).toEqual({ ...DEFAULT_LOOK, padding: 12 });
    const look = cloneLook(DEFAULT_LOOK); look.chrome.title = "Changed";
    expect(DEFAULT_LOOK.chrome.title).toBe("");
  });
  it("loads named presets and tolerates damaged storage", () => {
    expect(parsePresets("broken")).toEqual([]);
    const preset = { id: "one", name: "Studio", look: DEFAULT_LOOK };
    expect(parsePresets(JSON.stringify([preset]))).toEqual([preset]);
  });
  it("shares portrait aspect geometry without moving source coordinates", () => {
    const layout = computeLayout(1920, 1080, { x: 100, y: 50, w: 800, h: 600 }, { ...DEFAULT_LOOK, enabled: true, aspect: "9:16" });
    expect(layout.compositionW / layout.compositionH).toBeCloseTo(9 / 16, 3);
    expect(layout.cropX).toBe(100);
  });
});
