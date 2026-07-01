import { describe, it, expect } from "vitest";
import { EMPTY_COMBO, reduceKey, visibleChips } from "./fxKeystrokeModel";

const key = (text: string, isModifier: boolean, down: boolean) => ({ text, isModifier, down });

describe("fxKeystrokeModel", () => {
  it("holds modifiers while pressed and shows them with a key", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Shift", true, true), 0);
    s = reduceKey(s, key("S", false, true), 10);
    expect(visibleChips(s, 20, 1500)).toEqual(["Ctrl", "Shift", "S"]);
  });

  it("orders modifiers canonically regardless of press order", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Shift", true, true), 0);
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("A", false, true), 5);
    expect(visibleChips(s, 6, 1500)).toEqual(["Ctrl", "Shift", "A"]);
  });

  it("drops a released modifier from the held set", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Ctrl", true, false), 5);
    s = reduceKey(s, key("A", false, true), 10);
    expect(visibleChips(s, 11, 1500)).toEqual(["A"]);
  });

  it("expires chips after the ttl of inactivity", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("A", false, true), 0);
    expect(visibleChips(s, 100, 1500)).toEqual(["A"]);
    expect(visibleChips(s, 2000, 1500)).toBeNull();
  });

  it("shows a bare modifier chord (no main key) on modifier down", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    expect(visibleChips(s, 1, 1500)).toEqual(["Ctrl"]);
  });
});
