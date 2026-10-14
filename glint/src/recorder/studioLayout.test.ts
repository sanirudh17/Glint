import { expect, it } from "vitest";
import { DEFAULT_LOOK } from "../look/model";
import { clampCrop, studioLayout } from "./studioLayout";
it("clamps source crops and exports even portrait dimensions", () => {
  expect(clampCrop({ x: 999, y: -10, w: 500, h: 400 }, 800, 600)).toEqual({ x: 798, y: 0, w: 2, h: 400 });
  const l = studioLayout(1920, 1080, null, { ...DEFAULT_LOOK, enabled: true, aspect: "9:16" });
  expect(l.width).toBe(1080); expect(l.height).toBe(1920);
});
it("limits an oversized crop to the remaining source instead of shrinking to a partial typed value", () => {
  expect(clampCrop({ x: 0, y: 0, w: 2000, h: 1080 }, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  expect(clampCrop({ x: 101, y: 51, w: 2000, h: 2000 }, 1920, 1080)).toEqual({ x: 101, y: 51, w: 1819, h: 1029 });
});
