import { describe, it, expect } from "vitest";
import { EMPTY_COMBO, reduceKey, visibleChips } from "./fxKeystrokeModel";

const key = (text: string, isModifier: boolean, down: boolean, modifiers?: string[]) => ({
  text,
  isModifier,
  down,
  modifiers,
});

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

  it("preserves full shortcut when modifiers and keys are rapidly released", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Shift", true, true), 5);
    s = reduceKey(s, key("X", false, true), 10);
    // Rapid key releases within 20ms:
    s = reduceKey(s, key("X", false, false), 15);
    s = reduceKey(s, key("Shift", true, false), 20);
    s = reduceKey(s, key("Ctrl", true, false), 25);
    // Shortcut must NOT dismantle to X or Ctrl+X; it must stay Ctrl+Shift+X!
    expect(visibleChips(s, 30, 1500)).toEqual(["Ctrl", "Shift", "X"]);
    expect(visibleChips(s, 500, 1500)).toEqual(["Ctrl", "Shift", "X"]);
  });

  it("increments repeat count on multiple presses of key combination", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Shift", true, true), 5);
    s = reduceKey(s, key("X", false, true), 10);
    expect(visibleChips(s, 20, 1500)).toEqual(["Ctrl", "Shift", "X"]);

    // Press X again while modifiers held
    s = reduceKey(s, key("X", false, true), 100);
    expect(visibleChips(s, 110, 1500)).toEqual(["Ctrl", "Shift", "X", "×2"]);

    // Press X a third time
    s = reduceKey(s, key("X", false, true), 200);
    expect(visibleChips(s, 210, 1500)).toEqual(["Ctrl", "Shift", "X", "×3"]);
  });

  it("handles mouse clicks with modifiers and tracks repeated clicks", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Click", false, true), 50);
    expect(visibleChips(s, 60, 1500)).toEqual(["Ctrl", "Click"]);

    s = reduceKey(s, key("Click", false, true), 150);
    expect(visibleChips(s, 160, 1500)).toEqual(["Ctrl", "Click", "×2"]);

    s = reduceKey(s, key("Click", false, true), 250);
    expect(visibleChips(s, 260, 1500)).toEqual(["Ctrl", "Click", "×3"]);
  });

  it("does not leak Shift from a prior combo into Ctrl+Alt+X", () => {
    let s = EMPTY_COMBO;
    // First combo: Ctrl+Shift+X
    s = reduceKey(s, key("Ctrl", true, true), 0);
    s = reduceKey(s, key("Shift", true, true), 5);
    s = reduceKey(s, key("X", false, true), 10);
    s = reduceKey(s, key("Shift", true, false), 20);
    s = reduceKey(s, key("Ctrl", true, false), 25);

    // Later, combo expired: Ctrl+Alt+X
    s = reduceKey(s, key("Ctrl", true, true), 2000);
    s = reduceKey(s, key("Alt", true, true), 2005);
    s = reduceKey(s, key("X", false, true), 2010);
    expect(visibleChips(s, 2020, 1500)).toEqual(["Ctrl", "Alt", "X"]);
  });

  it("accurately synchronizes hardware-queried modifiers when supplied", () => {
    let s = EMPTY_COMBO;
    s = reduceKey(
      s,
      key("X", false, true, ["Ctrl", "Alt"]),
      10
    );
    expect(visibleChips(s, 20, 1500)).toEqual(["Ctrl", "Alt", "X"]);
  });
});
