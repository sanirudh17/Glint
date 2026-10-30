import { expect, it } from "vitest";
import { newZoom, splitZoom, validateZooms, zoomAt } from "./studioEffects";
const crop = { x: 100, y: 50, w: 800, h: 600 };
it("new cursor-aware zooms follow a curved path for the whole selected interval", () => {
  const segment = {...newZoom(1, 10, true), end: 8};
  expect(segment.mode).toBe('follow-cursor');
  expect(newZoom(1,10).mode).toBe('fixed');
  const positions = Array.from({length:121},(_,i)=>({
    x:500+250*Math.cos(i/120*Math.PI*2),y:350+180*Math.sin(i/120*Math.PI*2),
  }));
  const views=positions.map((point,i)=>zoomAt([segment],2+i/30,crop,1920,1080,{...point,latestX:point.x,latestY:point.y}));
  views.forEach((v,i)=>{
    expect(v.scale).toBe(2);
    expect(positions[i].x).toBeGreaterThan(v.x);
    expect(positions[i].x).toBeLessThan(v.x+v.w);
    expect(positions[i].y).toBeGreaterThan(v.y);
    expect(positions[i].y).toBeLessThan(v.y+v.h);
    expect(v.x).toBeGreaterThanOrEqual(crop.x);
    expect(v.x+v.w).toBeLessThanOrEqual(crop.x+crop.w);
  });
  expect(new Set(views.map(v=>v.x.toFixed(1))).size).toBeGreaterThan(30);
  expect(zoomAt([segment],8,crop,1920,1080).scale).toBe(1);
});
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
