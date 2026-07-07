import { describe, it, expect } from "vitest";
import { parseExportScale, scaledPixelRatio } from "./exportScale";

describe("parseExportScale", () => {
  it("returns 2 only for the string '2'", () => {
    expect(parseExportScale("2")).toBe(2);
  });
  it("defaults to 1 for anything else", () => {
    expect(parseExportScale("1")).toBe(1);
    expect(parseExportScale(null)).toBe(1);
    expect(parseExportScale("junk")).toBe(1);
  });
});

describe("scaledPixelRatio", () => {
  it("multiplies the base ratio by the scale", () => {
    expect(scaledPixelRatio(3, 1)).toBe(3);
    expect(scaledPixelRatio(3, 2)).toBe(6);
  });
});
