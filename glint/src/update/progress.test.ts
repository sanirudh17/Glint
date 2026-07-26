import { describe, it, expect } from "vitest";
import { pct, mb, progressLabel } from "./progress";

describe("pct", () => {
  it("computes a clamped percentage for a known total", () => {
    expect(pct(0, 100)).toBe(0);
    expect(pct(50, 100)).toBe(50);
    expect(pct(150, 100)).toBe(100); // clamped
  });

  it("returns null when the total is unknown or zero", () => {
    expect(pct(10, null)).toBeNull();
    expect(pct(10, 0)).toBeNull();
  });
});

describe("progressLabel", () => {
  it("shows downloaded-of-total when total is known", () => {
    expect(progressLabel(12_300_000, 99_100_000)).toBe("12.3 MB of 99.1 MB");
  });

  it("shows just the downloaded amount when total is unknown", () => {
    expect(progressLabel(12_300_000, null)).toBe(mb(12_300_000));
  });
});
