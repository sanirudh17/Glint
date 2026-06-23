import { describe, it, expect } from "vitest";
import { GRADIENTS, getGradient, konvaGradient } from "./gradients";

describe("gradients", () => {
  it("has at least 6 presets with unique ids", () => {
    expect(GRADIENTS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(GRADIENTS.map((g) => g.id)).size).toBe(GRADIENTS.length);
  });

  it("getGradient returns the match, else the first preset", () => {
    expect(getGradient(GRADIENTS[1].id)).toBe(GRADIENTS[1]);
    expect(getGradient("nope")).toBe(GRADIENTS[0]);
  });

  it("konvaGradient flattens stops to [offset,color,...]", () => {
    const g = { id: "x", label: "X", angleDeg: 0, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const k = konvaGradient(g, 100, 50);
    expect(k.fillLinearGradientColorStops).toEqual([0, "#000", 1, "#fff"]);
  });

  it("konvaGradient at 0deg runs left→right across the rect", () => {
    const g = { id: "x", label: "X", angleDeg: 0, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const k = konvaGradient(g, 100, 50);
    expect(k.fillLinearGradientStartPoint).toEqual({ x: 0, y: 25 });
    expect(k.fillLinearGradientEndPoint).toEqual({ x: 100, y: 25 });
  });

  it("konvaGradient at 135deg (the preset angle) spans top-right → bottom-left", () => {
    const g = { id: "x", label: "X", angleDeg: 135, stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }] };
    const k = konvaGradient(g, 100, 100);
    expect(k.fillLinearGradientStartPoint.x).toBeCloseTo(100);
    expect(k.fillLinearGradientStartPoint.y).toBeCloseTo(0);
    expect(k.fillLinearGradientEndPoint.x).toBeCloseTo(0);
    expect(k.fillLinearGradientEndPoint.y).toBeCloseTo(100);
  });
});
