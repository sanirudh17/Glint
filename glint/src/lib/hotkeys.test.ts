import { describe, it, expect } from "vitest";
import { keyEventToAccelerator, toChips } from "./hotkeys";

// Minimal KeyboardEvent-like stub (only the fields the mapper reads).
function ev(
  code: string,
  mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {},
  extra: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    code,
    key: code.startsWith("Key") ? code.slice(3) : code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: () => false,
    ...mods,
    ...extra,
  } as unknown as KeyboardEvent;
}

function evAltGraph(code: string, key = "a"): KeyboardEvent {
  return {
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    getModifierState: (k: string) => k === "AltGraph",
  } as unknown as KeyboardEvent;
}

describe("keyEventToAccelerator", () => {
  it("maps letters with modifiers", () => {
    expect(keyEventToAccelerator(ev("KeyA", { ctrlKey: true }, { key: "A" }))).toBe("Ctrl+A");
    expect(keyEventToAccelerator(ev("KeyC", { ctrlKey: true, shiftKey: true }, { key: "C" }))).toBe(
      "Ctrl+Shift+C",
    );
  });
  it("maps digits (row and numpad) to the bare digit", () => {
    expect(
      keyEventToAccelerator(ev("Digit1", { ctrlKey: true, shiftKey: true }, { key: "1" })),
    ).toBe("Ctrl+Shift+1");
    expect(keyEventToAccelerator(ev("Numpad5", { altKey: true }, { key: "5" }))).toBe("Alt+5");
  });
  it("maps Super (Win) modifier and F-keys", () => {
    expect(keyEventToAccelerator(ev("F5", { metaKey: true }, { key: "F5" }))).toBe("Super+F5");
    expect(keyEventToAccelerator(ev("F12", { altKey: true }, { key: "F12" }))).toBe("Alt+F12");
  });
  it("maps punctuation via code", () => {
    expect(keyEventToAccelerator(ev("Slash", { ctrlKey: true }, { key: "/" }))).toBe("Ctrl+/");
    expect(keyEventToAccelerator(ev("Minus", { altKey: true }, { key: "-" }))).toBe("Alt+-");
  });
  it("returns null when only modifiers are held", () => {
    expect(keyEventToAccelerator(ev("ControlLeft", { ctrlKey: true }, { key: "Control" }))).toBe(
      null,
    );
    expect(keyEventToAccelerator(ev("ShiftLeft", { shiftKey: true }, { key: "Shift" }))).toBe(null);
  });
  it("handles Ctrl+Alt via AltGraph (Windows layout)", () => {
    // Ctrl+Alt+H where H has an AltGr character: browser reports AltGraph true, ctrl/alt false.
    expect(keyEventToAccelerator(evAltGraph("KeyH", "h"))).toBe("Ctrl+Alt+H");
    expect(keyEventToAccelerator(evAltGraph("KeyQ", "q"))).toBe("Ctrl+Alt+Q");
    // Ctrl+Alt+Shift via AltGraph+Shift
    expect(
      keyEventToAccelerator({
        code: "KeyH",
        key: "H",
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
        metaKey: false,
        getModifierState: (k: string) => k === "AltGraph",
      } as unknown as KeyboardEvent),
    ).toBe("Ctrl+Alt+Shift+H");
  });
  it("maps all 26 letters with Ctrl+Alt", () => {
    for (let i = 0; i < 26; i++) {
      const code = `Key${String.fromCharCode(65 + i)}`;
      const letter = String.fromCharCode(65 + i);
      expect(keyEventToAccelerator(ev(code, { ctrlKey: true, altKey: true }, { key: letter }))).toBe(
        `Ctrl+Alt+${letter}`,
      );
    }
  });
  it("maps all 26 letters with every modifier combo", () => {
    const combos: Array<Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>>> = [
      { ctrlKey: true, altKey: true },
      { ctrlKey: true, shiftKey: true },
      { ctrlKey: true, metaKey: true },
      { shiftKey: true, metaKey: true },
      { shiftKey: true, altKey: true },
      { altKey: true, metaKey: true },
    ];
    // Our implementation orders mods as Ctrl, Alt, Shift, Super (Typr order).
    // The test should be order-insensitive (Rust normalizes by sorting).
    for (const combo of combos) {
      for (let i = 0; i < 26; i++) {
        const code = `Key${String.fromCharCode(65 + i)}`;
        const letter = String.fromCharCode(65 + i);
        const got = keyEventToAccelerator(ev(code, combo, { key: letter }))!;
        const gotParts = got.split("+");
        const gotKey = gotParts.pop();
        expect(gotKey).toBe(letter);
        const gotMods = new Set(gotParts);
        const wantMods = new Set(
          Object.entries(combo)
            .filter(([, v]) => v)
            .map(([k]) => (k === "ctrlKey" ? "Ctrl" : k === "altKey" ? "Alt" : k === "shiftKey" ? "Shift" : "Super")),
        );
        expect(gotMods).toEqual(wantMods);
      }
    }
  });
  it("returns single key without modifier (validation in Rust)", () => {
    expect(keyEventToAccelerator(ev("KeyA", {}, { key: "a" }))).toBe("A");
  });
  it("handles navigation keys", () => {
    expect(keyEventToAccelerator(ev("Home", { ctrlKey: true }, { key: "Home" }))).toBe("Ctrl+Home");
    expect(keyEventToAccelerator(ev("Delete", { altKey: true }, { key: "Delete" }))).toBe(
      "Alt+Delete",
    );
  });
});

describe("toChips", () => {
  it("splits and normalizes tokens for display", () => {
    expect(toChips("CmdOrCtrl+Shift+1")).toEqual(["Ctrl", "Shift", "1"]);
    expect(toChips("Super+F5")).toEqual(["Win", "F5"]);
  });
});
