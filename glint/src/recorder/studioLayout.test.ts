import { expect, it } from "vitest";
import { DEFAULT_LOOK } from "../look/model";
import { clampCrop, studioLayout } from "./studioLayout";
it("clamps source crops and exports even portrait dimensions", () => {
  expect(clampCrop({ x: 999, y: -10, w: 500, h: 400 }, 800, 600)).toEqual({ x: 798, y: 0, w: 2, h: 400 });
  const l = studioLayout(1920, 1080, null, { ...DEFAULT_LOOK, enabled: true, aspect: "9:16" });
  expect(l.width).toBe(1080); expect(l.height).toBe(1920);
});
