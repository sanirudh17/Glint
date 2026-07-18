import { describe, it, expect } from "vitest";
import { seedCursor, isLoupeVisible } from "./loupeVisibility";

describe("seedCursor (no mouse movement required)", () => {
  it("seeds the cursor from the backend position", () => {
    expect(seedCursor(640, 360)).toEqual({ x: 640, y: 360 });
  });

  it("accepts the origin (0,0) rather than treating it as absent", () => {
    // A falsy-check bug here would strand the loupe in the top-left corner case.
    expect(seedCursor(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("falls back to null when the backend could not read the cursor", () => {
    expect(seedCursor(null, null)).toBeNull();
    expect(seedCursor(undefined, undefined)).toBeNull();
    expect(seedCursor(NaN, 10)).toBeNull();
  });
});

describe("isLoupeVisible", () => {
  const base = { hasBitmap: true, hasRect: false, interacting: false };

  it("is visible on the FIRST paint with a seeded cursor and no pointermove", () => {
    // The regression: this was false until the user jiggled the mouse.
    expect(isLoupeVisible({ ...base, cursor: seedCursor(100, 200) })).toBe(true);
  });

  it("stays hidden while the cursor position is genuinely unknown", () => {
    expect(isLoupeVisible({ ...base, cursor: null })).toBe(false);
  });

  it("stays hidden until the frozen frame is decoded", () => {
    expect(isLoupeVisible({ ...base, cursor: { x: 1, y: 1 }, hasBitmap: false })).toBe(false);
  });

  it("hides once a selection is settled, and returns during a drag", () => {
    const cursor = { x: 1, y: 1 };
    expect(isLoupeVisible({ ...base, cursor, hasRect: true })).toBe(false);
    expect(isLoupeVisible({ ...base, cursor, hasRect: true, interacting: true })).toBe(true);
  });
});
