/**
 * fxKeystrokeModel — pure reducer for the recording keystroke overlay. Turns a
 * stream of key up/down events (already mapped to labels by the Rust hook) into a
 * canonical, TTL-expiring chip list for the bottom-center strip.
 */
export interface KeyInput { text: string; isModifier: boolean; down: boolean }
export interface ComboState { mods: string[]; key: string | null; at: number }

export const EMPTY_COMBO: ComboState = { mods: [], key: null, at: 0 };

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Win"];
const orderMods = (mods: string[]): string[] =>
  MOD_ORDER.filter((m) => mods.includes(m));

/** Apply one key event, returning the next state. `now` is a monotonic ms clock. */
export function reduceKey(state: ComboState, ev: KeyInput, now: number): ComboState {
  if (ev.isModifier) {
    const has = state.mods.includes(ev.text);
    const mods = ev.down
      ? (has ? state.mods : [...state.mods, ev.text])
      : state.mods.filter((m) => m !== ev.text);
    // A modifier press/release is itself activity: refresh `at` and show the chord.
    return { mods, key: ev.down ? null : state.key, at: now };
  }
  // Non-modifier: only `down` starts a combo (ignore key-up so the chip lingers).
  if (!ev.down) return state;
  return { mods: state.mods, key: ev.text, at: now };
}

/** The chips to draw, or null if the combo has expired (older than ttlMs). */
export function visibleChips(state: ComboState, now: number, ttlMs: number): string[] | null {
  const chips = [...orderMods(state.mods), ...(state.key ? [state.key] : [])];
  if (chips.length === 0) return null;
  if (now - state.at > ttlMs) return null;
  return chips;
}
