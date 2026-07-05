import { describe, it, expect } from "vitest";
import { clampPlacement, videoRectInBox, toPixels, DEFAULT_PLACEMENT, MIN_D, MAX_D } from "./camOverlay";

describe("clampPlacement", () => {
  it("keeps the bubble inside the frame", () => {
    const p = clampPlacement({ x: 0.95, y: 0.95, diameter: 0.2, visible: true });
    expect(p.x).toBeCloseTo(0.8);
    expect(p.y).toBeCloseTo(0.8);
  });
  it("clamps diameter to [MIN_D, MAX_D]", () => {
    expect(clampPlacement({ x: 0, y: 0, diameter: 5, visible: true }).diameter).toBe(MAX_D);
    expect(clampPlacement({ x: 0, y: 0, diameter: 0.001, visible: true }).diameter).toBe(MIN_D);
  });
  it("preserves visibility", () => {
    expect(clampPlacement({ x: 0, y: 0, diameter: 0.2, visible: false }).visible).toBe(false);
  });
});

describe("videoRectInBox", () => {
  it("letterboxes a 16:9 video in a square box", () => {
    const r = videoRectInBox({ w: 100, h: 100 }, 16 / 9);
    expect(r.w).toBe(100);
    expect(Math.round(r.h)).toBe(56);
    expect(r.x).toBe(0);
    expect(Math.round(r.y)).toBe(22);
  });
  it("pillarboxes a square video in a wide box", () => {
    const r = videoRectInBox({ w: 200, h: 100 }, 1);
    expect(r.h).toBe(100);
    expect(r.w).toBe(100);
    expect(r.x).toBe(50);
    expect(r.y).toBe(0);
  });
});

describe("toPixels", () => {
  it("maps normalized to even source pixels", () => {
    const px = toPixels({ x: 0.5, y: 0.25, diameter: 0.1, visible: true }, 1920, 1080);
    expect(px.x).toBe(960);
    expect(px.y).toBe(270);
    expect(px.d).toBe(192);
    expect(px.d % 2).toBe(0);
  });
});

it("default placement is valid and bottom-right", () => {
  const p = DEFAULT_PLACEMENT;
  expect(p.x + p.diameter).toBeCloseTo(1 - 0.03, 2);
  expect(p.y + p.diameter).toBeCloseTo(1 - 0.03, 2);
  expect(clampPlacement(p)).toEqual(p);
});
