import { describe, it, expect } from "vitest";
import { toCanvasXY, rippleRadius, rippleAlpha } from "./fxRender";

describe("fxRender", () => {
  it("maps physical screen coords to canvas-local device px (physical is already device px)", () => {
    // Overlay origin at (100,50) physical; a point at (300,250) physical is
    // (200,200) device px on the canvas. No ×scale — physical == device px, and the
    // canvas is already sized in device px, so subtracting the origin is the mapping.
    expect(toCanvasXY(300, 250, 100, 50)).toEqual({ x: 200, y: 200 });
  });

  it("ripple grows with age and clamps at maxR", () => {
    expect(rippleRadius(0, 500, 40)).toBeCloseTo(0, 5);
    expect(rippleRadius(250, 500, 40)).toBeCloseTo(20, 5);
    expect(rippleRadius(1000, 500, 40)).toBeCloseTo(40, 5); // past maxMs clamps
  });

  it("ripple fades from 1 to 0 over its life", () => {
    expect(rippleAlpha(0, 500)).toBeCloseTo(1, 5);
    expect(rippleAlpha(500, 500)).toBeCloseTo(0, 5);
    expect(rippleAlpha(1000, 500)).toBeCloseTo(0, 5);
  });
});
