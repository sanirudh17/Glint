import { describe, it, expect } from "vitest";
import { parseVersion, compareVersions, isNewer, shouldNotify } from "./version";

describe("parseVersion", () => {
  it("strips a leading v and splits into numbers", () => {
    expect(parseVersion("v0.1.4")).toEqual([0, 1, 4]);
    expect(parseVersion("0.1.4")).toEqual([0, 1, 4]);
  });

  it("drops a pre-release / build suffix", () => {
    expect(parseVersion("0.1.4-rc.1")).toEqual([0, 1, 4]);
    expect(parseVersion("v1.2.3+build9")).toEqual([1, 2, 3]);
  });
});

describe("compareVersions", () => {
  it("orders by numeric component, not string", () => {
    // "10" > "9" numerically — a string compare would get this wrong.
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.9", "0.1.10")).toBe(-1);
  });

  it("treats missing trailing components as zero", () => {
    expect(compareVersions("0.1", "0.1.0")).toBe(0);
    expect(compareVersions("v0.1.4", "0.1.4")).toBe(0);
  });
});

describe("isNewer", () => {
  it("is true only for a strictly greater version", () => {
    expect(isNewer("v0.1.4", "0.1.3")).toBe(true);
    expect(isNewer("0.1.3", "0.1.3")).toBe(false);
    expect(isNewer("0.1.2", "0.1.3")).toBe(false);
  });
});

describe("shouldNotify (one-time-per-version popup)", () => {
  const current = "0.1.3";

  it("notifies for a newer, not-yet-dismissed version", () => {
    expect(shouldNotify({ latest: "0.1.4", current, dismissed: null })).toBe(true);
  });

  it("stays silent once THIS version was dismissed", () => {
    expect(shouldNotify({ latest: "0.1.4", current, dismissed: "0.1.4" })).toBe(false);
    // tag-vs-plain normalisation still matches
    expect(shouldNotify({ latest: "v0.1.4", current, dismissed: "0.1.4" })).toBe(false);
  });

  it("notifies for a NEWER version even though an older one was dismissed", () => {
    // Dismissing 0.1.3's popup must not suppress the later 0.1.4 popup.
    expect(shouldNotify({ latest: "0.1.4", current, dismissed: "0.1.3" })).toBe(true);
  });

  it("never notifies when already on the latest (or ahead)", () => {
    expect(shouldNotify({ latest: "0.1.3", current, dismissed: null })).toBe(false);
    expect(shouldNotify({ latest: "0.1.2", current, dismissed: null })).toBe(false);
  });
});
