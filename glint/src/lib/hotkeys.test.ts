import { describe, it, expect } from "vitest";
import { keyEventToAccelerator, toChips } from "./hotkeys";

// Minimal KeyboardEvent-like stub (only the fields the mapper reads).
function ev(
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
): KeyboardEvent {
  return { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods } as KeyboardEvent;
}

describe("keyEventToAccelerator", () => {
  it("maps letters with modifiers", () => {
    expect(keyEventToAccelerator(ev("KeyA", { ctrlKey: true }))).toBe("Ctrl+A");
    expect(keyEventToAccelerator(ev("KeyC", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+C");
  });
  it("maps digits (row and numpad) to the bare digit", () => {
    expect(keyEventToAccelerator(ev("Digit1", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+1");
    expect(keyEventToAccelerator(ev("Numpad5", { altKey: true }))).toBe("Alt+5");
  });
  it("maps Super (Win) modifier and F-keys", () => {
    expect(keyEventToAccelerator(ev("F5", { metaKey: true }))).toBe("Super+F5");
    expect(keyEventToAccelerator(ev("F12", { altKey: true }))).toBe("Alt+F12");
  });
  it("maps punctuation via code", () => {
    expect(keyEventToAccelerator(ev("Slash", { ctrlKey: true }))).toBe("Ctrl+/");
    expect(keyEventToAccelerator(ev("Minus", { altKey: true }))).toBe("Alt+-");
  });
  it("returns null when only modifiers are held", () => {
    expect(keyEventToAccelerator(ev("ControlLeft", { ctrlKey: true }))).toBe(null);
    expect(keyEventToAccelerator(ev("ShiftLeft", { shiftKey: true }))).toBe(null);
  });
  it("returns the combo without a modifier too (validation happens in Rust)", () => {
    expect(keyEventToAccelerator(ev("KeyA"))).toBe("A");
  });
});

describe("toChips", () => {
  it("splits and normalizes tokens for display", () => {
    expect(toChips("CmdOrCtrl+Shift+1")).toEqual(["Ctrl", "Shift", "1"]);
    expect(toChips("Super+F5")).toEqual(["Win", "F5"]);
  });
});
