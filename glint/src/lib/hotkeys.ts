/**
 * hotkeys.ts — pure helpers for the rebindable-shortcuts panel. No React/Tauri imports.
 * `keyEventToAccelerator` turns a browser KeyboardEvent into a Tauri accelerator string;
 * `toChips` renders an accelerator as display tokens. Validation lives in Rust.
 *
 * Mirrors the proven Typr implementation (see C:/Users/sanir/Typr/src/main.ts):
 * - Ctrl+Alt is delivered as AltGr on Windows for keys with an AltGr character;
 *   those keydowns report ctrlKey=false/altKey=false but getModifierState("AltGraph")=true.
 *   Treat AltGr as its physical Ctrl+Alt components so Ctrl+Alt+<letter> captures.
 * - e.code → token is layout-independent (KeyA always means the A key).
 */

/** Modifier keys that should not be treated as the "main" key on their own. */
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS"]);

/** Physical-key (e.code) → accelerator token for non-alphanumeric keys. */
const CODE_KEY: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backquote: "`",
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

function modifiersFromEvent(e: KeyboardEvent): string[] {
  const altGraph =
    typeof e.getModifierState === "function" ? e.getModifierState("AltGraph") : false;
  const mods: string[] = [];
  // Use CmdOrCtrl for Ctrl so the accelerator matches Glint's defaults
  // (CmdOrCtrl+Shift+1) and Typr's proven cross-platform handling.
  // toChips normalizes CmdOrCtrl -> Ctrl for display.
  if (e.ctrlKey || altGraph) mods.push("CmdOrCtrl");
  if (e.altKey || altGraph) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  return mods;
}

function codeToKeyToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyD -> D
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit1 -> 1
  if (/^Numpad[0-9]$/.test(code)) return code.slice(6); // Numpad5 -> 5
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
  if (code in CODE_KEY) return CODE_KEY[code];
  // Additional navigation keys supported by Typr and valid in Rust's is_valid_key
  switch (code) {
    case "Home":
      return "Home";
    case "End":
      return "End";
    case "PageUp":
      return "PageUp";
    case "PageDown":
      return "PageDown";
    case "Insert":
      return "Insert";
    case "Delete":
      return "Delete";
    default:
      return null;
  }
}

/** Tauri accelerator for this event, or null if no main key is pressed yet. */
export function keyEventToAccelerator(e: KeyboardEvent): string | null {
  // If only a modifier is held, don't emit an accelerator yet — the capture
  // stays in "listening" state (mirrors Typr's preview logic).
  if (MODIFIER_KEYS.has(e.key)) return null;

  const mods = modifiersFromEvent(e);
  const key = codeToKeyToken(e.code);
  if (!key) return null; // unsupported physical key
  return [...mods, key].join("+");
}

/** Display chips for an accelerator, normalizing platform-neutral tokens. */
export function toChips(accel: string): string[] {
  return accel
    .replace(/CmdOrCtrl/g, "Ctrl")
    .replace(/CommandOrControl/g, "Ctrl")
    .replace(/Command/g, "Cmd")
    .replace(/Super/g, "Win")
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Whether the event is a pure modifier press (no main key). Used by the panel
 *  to keep the "Press keys..." preview alive without committing. */
export function isModifierOnly(e: KeyboardEvent): boolean {
  return MODIFIER_KEYS.has(e.key) || codeToKeyToken(e.code) === null;
}
