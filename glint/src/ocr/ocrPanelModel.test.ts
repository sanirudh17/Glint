import { describe, it, expect } from "vitest";
import { hasText, countsLabel, copyTarget } from "./ocrPanelModel";

describe("ocrPanelModel", () => {
  it("hasText is false for null / empty text, true otherwise", () => {
    expect(hasText(null)).toBe(false);
    expect(hasText({ text: "", line_count: 0, word_count: 0 })).toBe(false);
    expect(hasText({ text: "hi", line_count: 1, word_count: 1 })).toBe(true);
  });

  it("countsLabel reports line count and character length", () => {
    expect(countsLabel({ text: "hello\nworld", line_count: 2, word_count: 2 })).toBe(
      "2 lines · 11 chars",
    );
  });

  it("copyTarget returns the selection when non-empty", () => {
    expect(copyTarget("hello world", 0, 5)).toBe("hello");
  });

  it("copyTarget falls back to the whole value when nothing is selected", () => {
    expect(copyTarget("hello world", 3, 3)).toBe("hello world");
  });
});
