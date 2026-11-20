import { describe, it, expect } from "vitest";
import { hasText, copyTarget } from "./ocrPanelModel";

describe("ocrPanelModel", () => {
  it("hasText is false for null / empty text, true otherwise", () => {
    expect(hasText(null)).toBe(false);
    expect(hasText({ text: "", line_count: 0, word_count: 0 })).toBe(false);
    expect(hasText({ text: "hi", line_count: 1, word_count: 1 })).toBe(true);
  });

  it("copyTarget returns the selection when non-empty", () => {
    expect(copyTarget("hello world", 0, 5)).toBe("hello");
  });

  it("copyTarget falls back to the whole value when nothing is selected", () => {
    expect(copyTarget("hello world", 3, 3)).toBe("hello world");
  });
});
