import { describe, it, expect } from "vitest";
import { toCanvasXY, rippleRadius, rippleAlpha } from "./fxRender";

describe("fxRender", () => {
  it("maps physical screen coords to canvas-local device px", () => {
    // Overlay origin at (100,50) physical, DPR 2 → a point at (300,250) physical is
    // (200,200) physical-from-origin = (400,400) device px on the canvas.
    expect(toCanvasXY(300, 250, 100, 50, 2)).toEqual({ x: 400, y: 400 });
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
