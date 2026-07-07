import { describe, it, expect } from "vitest";
import { serializeToolStyles, parseToolStyles } from "./toolStylePersistence";
import { DEFAULT_STYLE } from "./model";

describe("toolStyle persistence", () => {
  it("round-trips a map through serialize → parse", () => {
    const map = { arrow: { ...DEFAULT_STYLE, color: "#ff0000" } };
    expect(parseToolStyles(serializeToolStyles(map))).toEqual(map);
  });
  it("returns {} for null / empty", () => {
    expect(parseToolStyles(null)).toEqual({});
    expect(parseToolStyles("")).toEqual({});
  });
  it("returns {} for malformed JSON", () => {
    expect(parseToolStyles("{not json")).toEqual({});
  });
  it("returns {} for a non-object payload", () => {
    expect(parseToolStyles("[1,2,3]")).toEqual({});
    expect(parseToolStyles("42")).toEqual({});
  });
  it("drops entries whose value isn't a style-shaped object", () => {
    const raw = JSON.stringify({ arrow: { color: "#123456", strokeWidth: 4 }, rect: "nope", bad: null });
    const out = parseToolStyles(raw);
    expect(Object.keys(out)).toEqual(["arrow"]);
  });
});
