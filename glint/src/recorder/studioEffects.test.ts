import { expect, it } from "vitest";
import { newZoom, splitZoom, validateZooms, zoomAt } from "./studioEffects";
const crop = { x: 100, y: 50, w: 800, h: 600 };
it("zooms smoothly inside the source crop at every focus edge", () => {
  for (const focus of [{x:0,y:0},{x:1,y:1},{x:.5,y:.5}]) {
    const segment = { ...newZoom(0, 10), focus, end: 4 };
    expect(zoomAt([segment], 0, crop, 1920, 1080).scale).toBe(1);
    for (const time of [.1,1,3.9]) {
      const view = zoomAt([segment], time, crop, 1920, 1080);
      expect(view.x).toBeGreaterThanOrEqual(crop.x); expect(view.y).toBeGreaterThanOrEqual(crop.y);
      expect(view.x+view.w).toBeLessThanOrEqual(crop.x+crop.w+.001);
      expect(view.y+view.h).toBeLessThanOrEqual(crop.y+crop.h+.001);
    }
  }
});
it("splitting preserves the easing trajectory including a split during the entrance", () => {
  const segment = {...newZoom(0,10),end:4}; const split = splitZoom(segment,.2);
  for (const t of [.1,.2,.3,1,3.9]) expect(zoomAt(split,t,crop,1920,1080)).toEqual(zoomAt([segment],t,crop,1920,1080));
});
it("follow cursor re-aims and clamps focus after cropping", () => {
  const segment = {...newZoom(0,10),mode:"follow-cursor" as const};
  const view = zoomAt([segment],1,crop,1920,1080,{x:1900,y:1000});
  expect(view.x).toBe(500);expect(view.y).toBe(350);
});
it("rejects invalid and duplicated effect settings", () => {
  const segment=newZoom(0,10);expect(validateZooms([segment],10)).toBe(true);
  expect(validateZooms([segment,segment],10)).toBe(false);
  expect(validateZooms([{...segment,focus:{x:NaN,y:0}}],10)).toBe(false);
});
it("follow cursor keeps a fast-moving pointer inside while the focus follower lags", () => {
  const segment={...newZoom(0,10),mode:'follow-cursor' as const};
  const view=zoomAt([segment],1,crop,1920,1080,{x:200,y:100,latestX:800,latestY:600});
  expect(view.x).toBeLessThan(800);expect(view.x+view.w).toBeGreaterThan(800);
  expect(view.y).toBeLessThan(600);expect(view.y+view.h).toBeGreaterThan(600);
});
