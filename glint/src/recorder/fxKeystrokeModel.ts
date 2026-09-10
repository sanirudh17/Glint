/**
 * fxKeystrokeModel — pure reducer for the recording keystroke overlay. Turns a
 * stream of key up/down events (already mapped to labels by the Rust hook) into a
 * canonical, TTL-expiring chip list for the bottom-center strip.
 */
export interface KeyInput {
  text: string;
  isModifier: boolean;
  down: boolean;
  modifiers?: string[];
}

export interface ComboState {
  mods: string[];
  heldMods?: string[];
  key: string | null;
  count: number;
  at: number;
  lastPressedAt?: number;
}

export const EMPTY_COMBO: ComboState = {
  mods: [],
  heldMods: [],
  key: null,
  count: 1,
  at: 0,
  lastPressedAt: 0,
};

const MOD_ORDER = ["Ctrl", "Alt", "Shift", "Win"];
export const orderMods = (mods: string[]): string[] =>
  MOD_ORDER.filter((m) => mods.includes(m));

/** Apply one key event, returning the next state. `now` is a monotonic ms clock. */
export function reduceKey(state: ComboState, ev: KeyInput, now: number): ComboState {
  // If the previous combo has fully expired (>1500ms since last activity),
  // reset stale combo state so phantom modifiers from the past never carry over.
  const isExpired = state.at > 0 && now - state.at > 1500;
  let held = isExpired ? [] : (state.heldMods ?? state.mods);

  // If hardware-queried modifiers were provided by the hook, sync truth directly.
  if (ev.modifiers) {
    held = ev.modifiers;
  }

  if (ev.isModifier) {
    if (!ev.modifiers) {
      if (ev.down) {
        if (!held.includes(ev.text)) held = [...held, ev.text];
      } else {
        held = held.filter((m) => m !== ev.text);
      }
    }

    if (ev.down) {
      // Modifier down: starting a modifier chord resets key
      return {
        mods: held,
        heldMods: held,
        key: null,
        count: 1,
        at: now,
        lastPressedAt: now,
      };
    } else {
      // Modifier up:
      // If a non-modifier key combination was completed (e.g. Ctrl+Shift+X or Ctrl+C),
      // releasing modifiers (fingers lifting off the keys rapidly) MUST NOT dismantle the
      // completed shortcut into Ctrl+X or X. The full shortcut remains locked on screen.
      if (state.key !== null && !isExpired) {
        return {
          ...state,
          heldMods: held,
        };
      }
      // Bare modifier release:
      return {
        mods: held,
        heldMods: held,
        key: null,
        count: 1,
        at: now,
        lastPressedAt: state.lastPressedAt ?? now,
      };
    }
  }

  // Non-modifier: key-up is ignored so chip lingers
  if (!ev.down) {
    return state;
  }

  // Non-modifier down:
  const activeMods = held;
  const sameMods =
    !isExpired &&
    state.mods.length === activeMods.length &&
    orderMods(state.mods).every((m, i) => m === orderMods(activeMods)[i]);
  const sameKey = !isExpired && state.key === ev.text;

  if (sameMods && sameKey) {
    // Repeated key press / click on the same combination: increment repeat count
    return {
      mods: state.mods,
      heldMods: held,
      key: ev.text,
      count: (state.count || 1) + 1,
      at: now,
      lastPressedAt: now,
    };
  }

  // Fresh combination
  return {
    mods: activeMods,
    heldMods: held,
    key: ev.text,
    count: 1,
    at: now,
    lastPressedAt: now,
  };
}

/** The chips to draw, or null if the combo has expired (older than ttlMs). */
export function visibleChips(state: ComboState, now: number, ttlMs: number): string[] | null {
  const mods = orderMods(state.mods);
  const chips: string[] = [...mods];
  if (state.key) {
    chips.push(state.key);
  }
  if (chips.length === 0) return null;
  if (now - state.at > ttlMs) return null;
  if (state.count && state.count > 1) {
    chips.push(`×${state.count}`);
  }
  return chips;
}
