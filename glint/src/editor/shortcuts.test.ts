import { describe, it, expect } from "vitest";
import { SHORTCUTS } from "./shortcuts";

describe("SHORTCUTS table", () => {
  it("has non-empty groups, each with at least one item", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0);
    for (const g of SHORTCUTS) {
      expect(g.title.length).toBeGreaterThan(0);
      expect(g.items.length).toBeGreaterThan(0);
    }
  });
  it("documents the core tools including the new eyedropper", () => {
    const all = SHORTCUTS.flatMap((g) => g.items);
    expect(all.some((i) => i.keys === "V" && /select/i.test(i.label))).toBe(true);
    expect(all.some((i) => i.keys === "I" && /eyedropper/i.test(i.label))).toBe(true);
    expect(all.some((i) => i.keys === "F" && /spotlight/i.test(i.label))).toBe(true);
  });
});
