/**
 * hotkeys.ts — pure helpers for the rebindable-shortcuts panel. No React/Tauri imports.
 * `keyEventToAccelerator` turns a browser KeyboardEvent into a Tauri accelerator string;
 * `toChips` renders an accelerator as display tokens. Validation lives in Rust.
 */

// Physical-key (e.code) → accelerator token for non-alphanumeric keys.
const CODE_KEY: Record<string, string> = {
  Minus: "-", Equal: "=", Comma: ",", Period: ".", Slash: "/", Backslash: "\\",
  Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Backquote: "`",
  Space: "Space", Tab: "Tab", Enter: "Enter",
  ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right",
};

/** Tauri accelerator for this event, or null if no main key is pressed yet. */
export function keyEventToAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^Numpad[0-9]$/.test(code)) key = code.slice(6);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (code in CODE_KEY) key = CODE_KEY[code];

  if (!key) return null; // only modifiers held, or an unsupported physical key
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
