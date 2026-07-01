# Recording FX (clicks · keystrokes · cursor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CleanShot X-style recording polish — click ripples, an on-screen keystroke overlay, and cursor emphasis (spotlight / hide / size) — baked into the MP4 at capture time.

**Architecture:** One transparent, click-through, always-on-top `rec-fx` overlay window covers the recording area and is **not** excluded from capture, so gdigrab records whatever it draws (the exact webcam-bubble trick, zero ffmpeg-pipeline rewrite). A recorder-owned global input listener (low-level `WH_MOUSE_LL` + `WH_KEYBOARD_LL` hooks on a dedicated message-pump thread) feeds `fx-*` events to the overlay's `<canvas>`, which renders the three effects. Cursor hide/size additionally flips gdigrab's `-draw_mouse` off and draws our own pointer.

**Tech Stack:** Rust (Tauri v2, `windows` crate for hooks), React 19 + TypeScript, Vite, Vitest, Zustand. Recorder module (`src-tauri/src/recorder/`) + frontend `src/recorder/`.

## Global Constraints

- **Local-first, single-user.** No cloud, upload, accounts, auth, or network calls. Copied verbatim from the spec: "Everything stays on my device."
- **Recorder isolation (SACRED).** All new Rust lives under `src-tauri/src/recorder/`; it imports **nothing** from `capture/`, `editor/`, `overlay/`, `ocr/`. `ocr/` imports nothing from `recorder/`.
- **ffmpeg pipeline stays intact.** The only pipeline touch is a conditional `-draw_mouse 0` arg (recorder-internal).
- **Visible feedback.** Every toggle gives immediate on-screen feedback; never silent.
- **Window-build rule.** Any command/fn that BUILDS a WebView2 window MUST run off the main thread (async command or spawned thread). Closing is safe from any thread.
- **All-windows-share-one-App.** main/HUD/overlay all mount the same `<App/>`; window-specific events use `emit_to`, never global `emit`.
- **Capability note.** The existing `recorder` capability already scopes `windows: ["rec-*"]` with `core:window:allow-set-ignore-cursor-events`, so the `rec-fx` label needs **no new capability file**.
- **FPS is 60** (`const FPS: u32 = 60` in `recorder/mod.rs`).
- **Privacy.** Input hooks are installed only when at least one FX is enabled, torn down on stop; events drive on-screen chips only — never persisted or transmitted.

## File Structure

**Rust — all under `src-tauri/src/recorder/`:**
- `fx/mod.rs` — FX session type (`FxConfig`, `FxSession`): owns the hook thread + overlay window; `start`/`stop`. `pub mod fx;` added to `recorder/mod.rs`.
- `fx/keymap.rs` — pure `vk_label(vk) -> Option<(&'static str, bool)>` (label, is_modifier). Unit-tested.
- `fx/hooks.rs` — low-level mouse/keyboard hook install + message pump + event forwarding; pure `throttle_ok` helper (tested).
- `fx/window.rs` — `build_fx_overlay` / `close_fx_overlay` (click-through `rec-fx` window). Off-main-thread build.
- `ffmpeg.rs` (modify) — `build_ffmpeg_args` gains a `draw_mouse: bool` param.
- `mod.rs` (modify) — `FxConfig` on `ActiveRecording`; `recorder_start` FX params; `recorder_set_fx` command; `RecorderStatusDto` FX fields; thread `draw_mouse` into `spawn_segment`.
- `settings/mod.rs` (modify) — 5 new fields + `apply_update` arms.
- `lib.rs` (modify) — register `recorder_set_fx`.

**Frontend — under `src/recorder/` (+ shared):**
- `fxKeystrokeModel.ts` (+ `.test.ts`) — pure combo/chip model.
- `fxRender.ts` (+ `.test.ts`) — pure ripple/coordinate math + canvas draw helpers.
- `FxOverlay.tsx` — the `<canvas>` overlay; listens for `fx-*`.
- `recfx.css` — overlay styles.
- `router.tsx` (modify) — `/rec-fx` route.
- `RegionSelect.tsx` (modify) — FX chips.
- `ControlBar.tsx` (modify) — live FX toggles.
- `lib/recorder.ts` (modify) — `recorderSetFx` + status type fields.
- Settings view (modify) — FX defaults toggles.

---

## Task 1: Settings — FX fields

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs`
- Modify: `glint/src/store/useAppStore.ts` (Settings TS type) — verify exact path in Step 5.

**Interfaces:**
- Produces: `Settings { record_click_viz: bool, record_keystrokes: bool, record_cursor_spotlight: bool, record_cursor_hide: bool, record_cursor_size: String }` where `record_cursor_size ∈ {"off","large","xl"}`. `apply_update` accepts each key.

- [ ] **Step 1: Write the failing tests** — append to the `tests` module in `settings/mod.rs`:

```rust
    #[test]
    fn defaults_fx_off() {
        let s = Settings::default();
        assert!(!s.record_click_viz);
        assert!(!s.record_keystrokes);
        assert!(!s.record_cursor_spotlight);
        assert!(!s.record_cursor_hide);
        assert_eq!(s.record_cursor_size, "off");
    }

    #[test]
    fn apply_update_sets_fx_bools() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_click_viz", json!(true)).unwrap();
        apply_update(&mut s, "record_keystrokes", json!(true)).unwrap();
        apply_update(&mut s, "record_cursor_spotlight", json!(true)).unwrap();
        apply_update(&mut s, "record_cursor_hide", json!(true)).unwrap();
        assert!(s.record_click_viz && s.record_keystrokes && s.record_cursor_spotlight && s.record_cursor_hide);
    }

    #[test]
    fn apply_update_sets_cursor_size_enum() {
        let mut s = Settings::default();
        apply_update(&mut s, "record_cursor_size", json!("xl")).unwrap();
        assert_eq!(s.record_cursor_size, "xl");
    }

    #[test]
    fn apply_update_rejects_bad_cursor_size() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "record_cursor_size", json!("huge")).is_err());
        assert!(apply_update(&mut s, "record_cursor_size", json!(3)).is_err());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings:: 2>&1 | tail -20`
Expected: FAIL — `no field record_click_viz`.

- [ ] **Step 3: Add the fields.** In `struct Settings`, after `record_webcam: bool,` add:

```rust
    pub record_click_viz: bool,
    pub record_keystrokes: bool,
    pub record_cursor_spotlight: bool,
    pub record_cursor_hide: bool,
    /// "off" | "large" | "xl" — recorded-cursor magnification.
    pub record_cursor_size: String,
```

In `impl Default`, after `record_webcam: false,` add:

```rust
            record_click_viz: false,
            record_keystrokes: false,
            record_cursor_spotlight: false,
            record_cursor_hide: false,
            record_cursor_size: "off".into(),
```

In `apply_update`, before the `other =>` arm add:

```rust
        "record_click_viz" => {
            s.record_click_viz = value.as_bool().ok_or("record_click_viz must be boolean")?;
        }
        "record_keystrokes" => {
            s.record_keystrokes = value.as_bool().ok_or("record_keystrokes must be boolean")?;
        }
        "record_cursor_spotlight" => {
            s.record_cursor_spotlight =
                value.as_bool().ok_or("record_cursor_spotlight must be boolean")?;
        }
        "record_cursor_hide" => {
            s.record_cursor_hide = value.as_bool().ok_or("record_cursor_hide must be boolean")?;
        }
        "record_cursor_size" => {
            let v = value.as_str().ok_or("record_cursor_size must be string")?;
            if !matches!(v, "off" | "large" | "xl") {
                return Err("record_cursor_size must be off|large|xl".into());
            }
            s.record_cursor_size = v.to_string();
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test settings:: 2>&1 | tail -20`
Expected: PASS (all settings tests, including the 4 new).

- [ ] **Step 5: Mirror the TS Settings type.** Find it: `cd glint && grep -rn "record_webcam" src/`. In the interface that has `record_webcam: boolean;` add:

```ts
  record_click_viz: boolean;
  record_keystrokes: boolean;
  record_cursor_spotlight: boolean;
  record_cursor_hide: boolean;
  record_cursor_size: "off" | "large" | "xl";
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd glint && npx tsc --noEmit`
Expected: clean.

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src/
git commit -m "feat(p11): settings fields for recording FX (clicks/keystrokes/cursor)"
```

---

## Task 2: Rust keymap — `vk_label`

**Files:**
- Create: `glint/src-tauri/src/recorder/fx/keymap.rs`
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `pub mod fx;`)
- Create: `glint/src-tauri/src/recorder/fx/mod.rs` (stub declaring `pub mod keymap;`)

**Interfaces:**
- Produces: `pub fn vk_label(vk: u32) -> Option<(&'static str, bool)>` — returns `(display_label, is_modifier)` for keys we visualize, `None` for keys we ignore.

- [ ] **Step 1: Create the fx module stub.** `glint/src-tauri/src/recorder/fx/mod.rs`:

```rust
//! Recording FX — click / keystroke / cursor visual effects. ISOLATED: imports
//! nothing from capture/editor/overlay/ocr. gdigrab records the on-screen overlay
//! for free (webcam-bubble pattern); no ffmpeg-pipeline rewrite.

pub mod keymap;
```

Add to `recorder/mod.rs` after the other `pub mod` lines (e.g. after `pub mod windows;`):

```rust
pub mod fx;
```

- [ ] **Step 2: Write the failing test.** `glint/src-tauri/src/recorder/fx/keymap.rs`:

```rust
//! Pure virtual-key → display-label mapping for the keystroke overlay. No Win32
//! imports here — the raw vk arrives from the hook; this table is unit-testable.

/// Map a Windows virtual-key code to a display label + whether it's a modifier.
/// Returns None for keys we don't visualize.
pub fn vk_label(vk: u32) -> Option<(&'static str, bool)> {
    let m = |s| Some((s, true));
    let k = |s| Some((s, false));
    match vk {
        // Modifiers (generic + L/R variants the LL hook may deliver).
        0x10 | 0xA0 | 0xA1 => m("Shift"),
        0x11 | 0xA2 | 0xA3 => m("Ctrl"),
        0x12 | 0xA4 | 0xA5 => m("Alt"),
        0x5B | 0x5C => m("Win"),
        // Letters A–Z.
        0x41..=0x5A => k(LETTERS[(vk - 0x41) as usize]),
        // Top-row digits 0–9.
        0x30..=0x39 => k(DIGITS[(vk - 0x30) as usize]),
        // Common named keys.
        0x0D => k("Enter"),
        0x1B => k("Esc"),
        0x20 => k("Space"),
        0x09 => k("Tab"),
        0x08 => k("Backspace"),
        0x2E => k("Del"),
        0x25 => k("←"),
        0x26 => k("↑"),
        0x27 => k("→"),
        0x28 => k("↓"),
        0x70..=0x7B => k(FKEYS[(vk - 0x70) as usize]),
        _ => None,
    }
}

const LETTERS: [&str; 26] = [
    "A","B","C","D","E","F","G","H","I","J","K","L","M",
    "N","O","P","Q","R","S","T","U","V","W","X","Y","Z",
];
const DIGITS: [&str; 10] = ["0","1","2","3","4","5","6","7","8","9"];
const FKEYS: [&str; 12] = ["F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_letters_and_digits() {
        assert_eq!(vk_label(0x41), Some(("A", false)));
        assert_eq!(vk_label(0x5A), Some(("Z", false)));
        assert_eq!(vk_label(0x30), Some(("0", false)));
        assert_eq!(vk_label(0x39), Some(("9", false)));
    }

    #[test]
    fn modifiers_flagged() {
        assert_eq!(vk_label(0x11), Some(("Ctrl", true)));
        assert_eq!(vk_label(0xA2), Some(("Ctrl", true)));
        assert_eq!(vk_label(0x10), Some(("Shift", true)));
        assert_eq!(vk_label(0x5B), Some(("Win", true)));
    }

    #[test]
    fn named_and_function_keys() {
        assert_eq!(vk_label(0x1B), Some(("Esc", false)));
        assert_eq!(vk_label(0x20), Some(("Space", false)));
        assert_eq!(vk_label(0x70), Some(("F1", false)));
        assert_eq!(vk_label(0x7B), Some(("F12", false)));
    }

    #[test]
    fn unknown_is_none() {
        assert_eq!(vk_label(0x00), None);
        assert_eq!(vk_label(0xFF), None);
    }
}
```

- [ ] **Step 3: Run to verify pass** (test written with impl — this task is a pure table)

Run: `cd glint/src-tauri && cargo test fx::keymap 2>&1 | tail -20`
Expected: PASS (4 tests). If the module isn't found, confirm `pub mod fx;` and `pub mod keymap;` are wired.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/recorder/fx/ glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p11): pure vk->label keymap for keystroke overlay"
```

---

## Task 3: Frontend keystroke model

**Files:**
- Create: `glint/src/recorder/fxKeystrokeModel.ts`
- Create: `glint/src/recorder/fxKeystrokeModel.test.ts`

**Interfaces:**
- Consumes: `fx-key` payloads `{ text: string, isModifier: boolean, down: boolean }` (emitted by the hook via `keymap::vk_label`).
- Produces:
  - `interface ComboState { mods: string[]; key: string | null; at: number }`
  - `const EMPTY_COMBO: ComboState`
  - `function reduceKey(state: ComboState, ev: { text: string; isModifier: boolean; down: boolean }, now: number): ComboState`
  - `function visibleChips(state: ComboState, now: number, ttlMs: number): string[] | null`

- [ ] **Step 1: Write the failing test.** `glint/src/recorder/fxKeystrokeModel.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint && npx vitest run src/recorder/fxKeystrokeModel.test.ts 2>&1 | tail -20`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement.** `glint/src/recorder/fxKeystrokeModel.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint && npx vitest run src/recorder/fxKeystrokeModel.test.ts 2>&1 | tail -20`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add glint/src/recorder/fxKeystrokeModel.ts glint/src/recorder/fxKeystrokeModel.test.ts
git commit -m "feat(p11): pure keystroke-combo model for the FX overlay"
```

---

## Task 4: gdigrab `draw_mouse` arg

**Files:**
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (signature + one insert + tests)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (call site in `spawn_segment` + thread a `draw_mouse` param)

**Interfaces:**
- Produces: `build_ffmpeg_args(target, fps, out, audio, want_audio, draw_mouse: bool)` — inserts `-draw_mouse 0` right after `-f gdigrab` when `draw_mouse == false`; unchanged (cursor drawn) when `true`.
- Consumes (mod.rs): `spawn_segment(..., draw_mouse: bool)` sourced from `ActiveRecording` FX config (Task 7); until then pass `true`.

- [ ] **Step 1: Write the failing tests.** In `ffmpeg.rs` `tests` module add:

```rust
    #[test]
    fn draw_mouse_off_inserts_flag() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, false);
        // -draw_mouse 0 must sit immediately after "gdigrab"
        let i = a.iter().position(|s| s == "gdigrab").unwrap();
        assert_eq!(a[i + 1], "-draw_mouse");
        assert_eq!(a[i + 2], "0");
    }

    #[test]
    fn draw_mouse_on_omits_flag() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, true);
        assert!(!a.iter().any(|s| s == "-draw_mouse"));
    }
```

Update the three existing calls to `build_ffmpeg_args(...)` inside `ffmpeg.rs` tests (e.g. `fullscreen_args_have_no_offset`) to pass a trailing `true`.

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test ffmpeg:: 2>&1 | tail -20`
Expected: FAIL — arity mismatch / missing `-draw_mouse`.

- [ ] **Step 3: Implement.** Change the signature:

```rust
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput], want_audio: bool, draw_mouse: bool) -> Vec<String> {
```

Immediately after the `-f gdigrab` / `-framerate` vec init (before the region block), insert:

```rust
    if !draw_mouse {
        // Hide the OS cursor in the capture; the FX overlay draws our own pointer.
        a.extend(["-draw_mouse".into(), "0".into()]);
    }
```

- [ ] **Step 4: Update the production call site.** In `mod.rs` `spawn_segment`, change its signature to accept `draw_mouse: bool` and pass it through:

```rust
async fn spawn_segment(
    app: &AppHandle,
    target: RecordTarget,
    fps: u32,
    path: &str,
    seg_index: usize,
    cfg: AudioConfig,
    controls: &AudioControls,
    draw_mouse: bool,
) -> Result<Segment, String> {
```

At the `build_ffmpeg_args` call (currently line ~183):

```rust
    let args = ffmpeg::build_ffmpeg_args(&target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse);
```

Update the two `spawn_segment(...)` call sites (in `recorder_start` and `recorder_resume`) to pass `true` for now (Task 7 wires the real value):

```rust
    // recorder_start seg0:
    let seg0 = match spawn_segment(&app, target, FPS, &segment_path(&out_str, 0), 0, audio_cfg, &controls, true).await {
    // recorder_resume:
    let seg = spawn_segment(&app, target, fps, &path, idx, cfg, &controls, true).await
```

- [ ] **Step 5: Run to verify pass**

Run: `cd glint/src-tauri && cargo test ffmpeg:: 2>&1 | tail -20 && cargo build 2>&1 | tail -5`
Expected: tests PASS; build succeeds.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/ffmpeg.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p11): thread draw_mouse through ffmpeg args (cursor-hide plumbing)"
```

---

## Task 5: FX overlay window + route + minimal overlay (SPIKE)

> **Risk gate.** This task verifies the load-bearing assumption: gdigrab captures a click-through layered window's drawn pixels. Build the overlay with a visible test pattern, record 2s, and confirm the pattern is in the MP4 **before** building renderers.

**Files:**
- Create: `glint/src-tauri/src/recorder/fx/window.rs`
- Modify: `glint/src-tauri/src/recorder/fx/mod.rs` (add `pub mod window;`)
- Create: `glint/src/recorder/FxOverlay.tsx`
- Create: `glint/src/recorder/recfx.css`
- Modify: `glint/src/router.tsx` (add `/rec-fx`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (temporary `recorder_fx_overlay_check` command)
- Modify: `glint/src-tauri/src/lib.rs` (register the temp command)

**Interfaces:**
- Produces: `fx::window::build_fx_overlay(app: &AppHandle, target: RecordTarget) -> tauri::Result<()>`, `fx::window::close_fx_overlay(app: &AppHandle)`, `pub const FX_LABEL: &str = "rec-fx";`.

- [ ] **Step 1: Write the overlay window builder.** `glint/src-tauri/src/recorder/fx/window.rs`:

```rust
//! The rec-fx overlay: a transparent, click-through, always-on-top, focus-less
//! window covering the recording area. NOT excluded from capture — gdigrab records
//! whatever its canvas draws (the webcam-bubble trick). Built off the main thread.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::recorder::RecordTarget;

pub const FX_LABEL: &str = "rec-fx";

pub fn build_fx_overlay(app: &AppHandle, target: RecordTarget) -> tauri::Result<()> {
    if app.get_webview_window(FX_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, FX_LABEL, WebviewUrl::App("index.html#/rec-fx".into()))
        .title("Glint FX")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    // Cover the recording area in PHYSICAL px (region coords are physical; fullscreen
    // = whole primary monitor). Mirrors build_cam_bubble's target math.
    if let Some(m) = win.primary_monitor()? {
        let (x, y, w, h) = match target {
            RecordTarget::Region { x, y, w, h } => (x, y, w as i32, h as i32),
            RecordTarget::Fullscreen => {
                let pos = m.position();
                let size = m.size();
                (pos.x, pos.y, size.width as i32, size.height as i32)
            }
        };
        win.set_position(tauri::PhysicalPosition { x, y })?;
        win.set_size(tauri::PhysicalSize { width: w as u32, height: h as u32 })?;
    }

    // Click-through: pointer events pass to the app underneath. Permitted by the
    // `recorder` capability (core:window:allow-set-ignore-cursor-events, rec-*).
    win.set_ignore_cursor_events(true)?;
    win.show()?;
    Ok(())
}

/// Force-tear-down (destroy, not close) so a transparent focus-less window can't
/// linger on screen and keep getting recorded — same rationale as the cam bubble.
pub fn close_fx_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(FX_LABEL) {
        let _ = w.destroy();
    }
}
```

Add `pub mod window;` to `recorder/fx/mod.rs`.

- [ ] **Step 2: Minimal overlay frontend with a test pattern.** `glint/src/recorder/FxOverlay.tsx`:

```tsx
/** FxOverlay (route #/rec-fx) — canvas the recorder draws effects on; gdigrab
 * records it. SPIKE state: draws a static diagonal test pattern so we can confirm
 * the overlay is captured in the MP4. Renderers land in Task 8. */
import { useEffect, useRef } from "react";
import "./recfx.css";

export function FxOverlay() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = window.innerWidth;
    c.height = window.innerHeight;
    const ctx = c.getContext("2d")!;
    // SPIKE: a bright translucent border + an X so it's unmistakable on capture.
    ctx.strokeStyle = "rgba(255,64,64,0.9)";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, c.width - 8, c.height - 8);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(c.width, c.height);
    ctx.moveTo(c.width, 0); ctx.lineTo(0, c.height);
    ctx.stroke();
  }, []);
  return <canvas ref={ref} className="fx-canvas" />;
}
```

`glint/src/recorder/recfx.css`:

```css
.fx-canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; background: transparent; }
html, body, #root { background: transparent !important; }
```

- [ ] **Step 3: Register the route.** In `router.tsx`, import `FxOverlay` and add before the `/` route (alongside `/rec-cam`):

```tsx
  {
    /** Chrome-free FX overlay — transparent, click-through; gdigrab records it. */
    path: "/rec-fx",
    element: <FxOverlay />,
  },
```

- [ ] **Step 4: Add a temporary spike command.** In `recorder/mod.rs`:

```rust
/// SPIKE (temporary): open the FX overlay with its test pattern over the primary
/// monitor so we can start a normal recording and confirm gdigrab captures it.
/// Removed once Task 8 lands. Off the main thread — it builds a window.
#[tauri::command(async)]
pub async fn recorder_fx_overlay_check(app: tauri::AppHandle) -> Result<(), String> {
    fx::window::build_fx_overlay(&app, RecordTarget::Fullscreen).map_err(|e| e.to_string())
}
```

Register it in `lib.rs` `invoke_handler` (next to `recorder::recorder_set_webcam`): `recorder::recorder_fx_overlay_check,`.

- [ ] **Step 5: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -10 && cd .. && npx tsc --noEmit`
Expected: both clean.

- [ ] **Step 6: At-screen spike verification (MANUAL — the risk gate).**

Kill any stray dev instance first: `powershell -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue"`.
Run the app (`npm run tauri dev`). In devtools/console of the main window, run `window.__TAURI__.core.invoke('recorder_fx_overlay_check')` to show the pattern. Then start a **fullscreen** recording, wait ~2s, stop, and open the resulting MP4.
Expected: the red border + X are visible in the recorded video, and the overlay does **not** block clicks to apps underneath.
If the pattern is NOT captured: STOP and reassess (fallback options in the spec §Risks) before continuing.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/recorder/fx/window.rs glint/src-tauri/src/recorder/fx/mod.rs \
  glint/src/recorder/FxOverlay.tsx glint/src/recorder/recfx.css glint/src/router.tsx \
  glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p11): rec-fx click-through overlay window + capture spike"
```

---

## Task 6: Global input hooks

**Files:**
- Create: `glint/src-tauri/src/recorder/fx/hooks.rs`
- Modify: `glint/src-tauri/src/recorder/fx/mod.rs` (add `pub mod hooks;`)
- Modify: `glint/src-tauri/Cargo.toml` (add `windows` features — verify which are already present)

**Interfaces:**
- Produces:
  - `pub fn throttle_ok(last_ms: u64, now_ms: u64, min_gap_ms: u64) -> bool` (pure, tested).
  - `pub struct HookHandle { thread_id: u32, join: Option<std::thread::JoinHandle<()>> }` with `pub fn stop(self)`.
  - `pub fn start_hooks(app: AppHandle, cfg: super::FxConfig) -> HookHandle` — installs mouse+keyboard LL hooks on a dedicated message-pump thread; emits `fx-click` / `fx-cursor` / `fx-key` to `rec-fx`.
- Consumes: `super::FxConfig` (Task 7) — but define a local minimal shape here and have Task 7's `FxConfig` match. To avoid a forward dependency, define `FxConfig` in `fx/mod.rs` in this task (Step 1).

- [ ] **Step 1: Define `FxConfig` in `fx/mod.rs`** (used by hooks + session):

```rust
/// Which effects are active for a recording. `cursor_hide` implies drawing our own
/// pointer (gdigrab draw_mouse off). `cursor_size` ∈ {"off","large","xl"}.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FxConfig {
    pub click_viz: bool,
    pub keystrokes: bool,
    pub spotlight: bool,
    pub cursor_hide: bool,
    /// 0 = off, 1 = large, 2 = xl.
    pub cursor_size: u8,
}

impl FxConfig {
    /// Any overlay-drawn effect active → we need the overlay + input hooks.
    pub fn needs_overlay(&self) -> bool {
        self.click_viz || self.keystrokes || self.spotlight || self.cursor_hide || self.cursor_size > 0
    }
    /// Any effect that needs the global input hooks (mouse/keyboard).
    pub fn needs_hooks(&self) -> bool {
        self.click_viz || self.keystrokes || self.spotlight || self.cursor_hide || self.cursor_size > 0
    }
    /// gdigrab should draw the OS cursor unless we're replacing it.
    pub fn draw_mouse(&self) -> bool {
        !(self.cursor_hide || self.cursor_size > 0)
    }
}
```

Add `pub mod hooks;` to `fx/mod.rs`.

- [ ] **Step 2: Write the failing test for the pure helper.** In `fx/hooks.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::throttle_ok;

    #[test]
    fn throttle_allows_after_gap() {
        assert!(throttle_ok(0, 20, 16));   // 20ms since last ≥ 16ms gap
        assert!(!throttle_ok(0, 10, 16));  // only 10ms elapsed
        assert!(throttle_ok(100, 116, 16));
    }
}
```

- [ ] **Step 3: Run to verify failure**

Run: `cd glint/src-tauri && cargo test fx::hooks 2>&1 | tail -20`
Expected: FAIL — module/function missing.

- [ ] **Step 4: Implement the hooks module.** `glint/src-tauri/src/recorder/fx/hooks.rs`:

```rust
//! Global low-level mouse + keyboard hooks feeding the rec-fx overlay. The hooks
//! run on a dedicated thread with a Win32 message pump (LL hooks require a message
//! loop on the installing thread). Callbacks stay non-blocking: they emit a small
//! Tauri event to the overlay and return immediately. Keylogger-shaped but LOCAL —
//! events only drive on-screen chips, never persisted or sent.

use std::cell::Cell;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, HHOOK, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_MOUSEMOVE,
    WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

/// Pure throttle predicate — true if enough time elapsed to emit again.
pub fn throttle_ok(last_ms: u64, now_ms: u64, min_gap_ms: u64) -> bool {
    now_ms.saturating_sub(last_ms) >= min_gap_ms
}

// Per-hook-thread context. LL hook callbacks are plain C fns with no user param, so
// the AppHandle + config + throttle clock live in thread-locals set at thread start.
thread_local! {
    static APP: Cell<Option<AppHandle>> = const { Cell::new(None) };
    static CFG: Cell<super::FxConfig> = const { Cell::new(super::FxConfig {
        click_viz: false, keystrokes: false, spotlight: false, cursor_hide: false, cursor_size: 0,
    }) };
    static LAST_MOVE: Cell<u64> = const { Cell::new(0) };
}

const MOVE_GAP_MS: u64 = 16; // ~60 Hz cursor emits

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit(event: &str, payload: serde_json::Value) {
    APP.with(|a| {
        // take/replace so we borrow the AppHandle without cloning the Cell contents away.
        if let Some(app) = a.take() {
            let _ = app.emit_to(super::window::FX_LABEL, event, payload);
            a.set(Some(app));
        }
    });
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let (x, y) = (info.pt.x, info.pt.y);
        match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                if CFG.with(|c| c.get().click_viz) {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "left" }));
                }
            }
            WM_RBUTTONDOWN => {
                if CFG.with(|c| c.get().click_viz) {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "right" }));
                }
            }
            WM_MOUSEMOVE => {
                let cfg = CFG.with(|c| c.get());
                if cfg.spotlight || cfg.cursor_hide || cfg.cursor_size > 0 {
                    let now = now_ms();
                    let last = LAST_MOVE.with(|l| l.get());
                    if throttle_ok(last, now, MOVE_GAP_MS) {
                        LAST_MOVE.with(|l| l.set(now));
                        emit("fx-cursor", serde_json::json!({ "x": x, "y": y }));
                    }
                }
            }
            _ => {}
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && CFG.with(|c| c.get().keystrokes) {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if down || up {
            if let Some((label, is_mod)) = super::keymap::vk_label(info.vkCode) {
                emit("fx-key", serde_json::json!({ "text": label, "isModifier": is_mod, "down": down }));
            }
        }
    }
    CallNextHookEx(HHOOK::default(), code, wparam, lparam)
}

pub struct HookHandle {
    thread_id: u32,
    join: Option<std::thread::JoinHandle<()>>,
}

impl HookHandle {
    /// Signal the pump thread to quit and join it (unhooks on the way out).
    pub fn stop(mut self) {
        unsafe { let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)); }
        if let Some(j) = self.join.take() { let _ = j.join(); }
    }
}

/// Install the hooks on a fresh thread and run its message pump. Returns a handle
/// whose `stop()` cleanly unhooks + joins.
pub fn start_hooks(app: AppHandle, cfg: super::FxConfig) -> HookHandle {
    let (tx, rx) = std::sync::mpsc::channel::<u32>();
    let join = std::thread::spawn(move || {
        APP.with(|a| a.set(Some(app)));
        CFG.with(|c| c.set(cfg));
        // Publish our thread id so the caller can PostThreadMessage(WM_QUIT).
        let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
        let _ = tx.send(tid);

        let mouse = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) };
        let keyboard = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) };

        // Standard LL-hook message pump. GetMessageW returns 0 on WM_QUIT → exit.
        unsafe {
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if let Ok(h) = mouse { let _ = UnhookWindowsHookEx(h); }
            if let Ok(h) = keyboard { let _ = UnhookWindowsHookEx(h); }
        }
        APP.with(|a| { a.take(); });
    });
    let thread_id = rx.recv().unwrap_or(0);
    HookHandle { thread_id, join: Some(join) }
}
```

- [ ] **Step 5: Ensure the needed `windows` features.** Check `Cargo.toml`:

Run: `cd glint/src-tauri && grep -n "features" Cargo.toml | head` and inspect the `[dependencies.windows]` (or `windows = { ... features = [...] }`). Ensure these features are present (add any missing): `"Win32_UI_WindowsAndMessaging"`, `"Win32_Foundation"`, `"Win32_System_Threading"`. Then, after editing capabilities/features, force a clean rebuild of the crate.

- [ ] **Step 6: Run tests + build**

Run: `cd glint/src-tauri && cargo test fx::hooks 2>&1 | tail -20 && cargo build 2>&1 | tail -15`
Expected: `throttle_allows_after_gap` PASS; crate builds. Fix any `windows` API path/feature errors surfaced by the compiler (the 0.62 API names above are current, but feature-gated).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/recorder/fx/hooks.rs glint/src-tauri/src/recorder/fx/mod.rs glint/src-tauri/Cargo.toml
git commit -m "feat(p11): global LL mouse/keyboard hooks feeding rec-fx"
```

---

## Task 7: FX session lifecycle + recorder wiring

**Files:**
- Modify: `glint/src-tauri/src/recorder/fx/mod.rs` (`FxSession`, `start`/`stop`)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`ActiveRecording` field; `recorder_start` params + start/stop overlay+hooks; `recorder_set_fx`; `RecorderStatusDto` fields; real `draw_mouse` into `spawn_segment`; remove the temp spike command)
- Modify: `glint/src-tauri/src/lib.rs` (register `recorder_set_fx`; drop `recorder_fx_overlay_check`)

**Interfaces:**
- Produces:
  - `fx::FxSession { hooks: Option<hooks::HookHandle> }` with `fx::start(app, target, cfg) -> FxSession` (builds overlay if `cfg.needs_overlay()`, starts hooks if `cfg.needs_hooks()`) and `FxSession::stop(self, app)` (stops hooks, closes overlay).
  - `recorder_set_fx(app, effect: String, on: bool)` command — live-toggles `click_viz|keystrokes|spotlight` (overlay-only; instant). Hide/size are start-time and rejected here.
- Consumes: `FxConfig` (Task 6), `build_fx_overlay`/`close_fx_overlay` (Task 5), `start_hooks`/`HookHandle` (Task 6).

- [ ] **Step 1: Add the session type to `fx/mod.rs`:**

```rust
use tauri::AppHandle;
use crate::recorder::RecordTarget;

/// A running FX session: the overlay window + the input-hook thread. Started with a
/// recording (when any effect is on) and torn down on stop/cancel.
pub struct FxSession {
    hooks: Option<hooks::HookHandle>,
}

pub fn start(app: &AppHandle, target: RecordTarget, cfg: FxConfig) -> FxSession {
    if cfg.needs_overlay() {
        let _ = window::build_fx_overlay(app, target);
    }
    let hooks = if cfg.needs_hooks() {
        Some(hooks::start_hooks(app.clone(), cfg))
    } else {
        None
    };
    FxSession { hooks }
}

impl FxSession {
    pub fn stop(self, app: &AppHandle) {
        if let Some(h) = self.hooks { h.stop(); }
        window::close_fx_overlay(app);
    }
}
```

- [ ] **Step 2: Store FX state on `ActiveRecording`.** In `mod.rs`, add to the struct (after `webcam_on: bool,`):

```rust
    /// Active recording FX (click/keystroke/cursor). The overlay + hooks live here.
    pub fx_cfg: fx::FxConfig,
    pub fx: Option<fx::FxSession>,
```

- [ ] **Step 3: Add FX params to `recorder_start`.** Extend the signature:

```rust
    click_viz: Option<bool>,
    keystrokes: Option<bool>,
    spotlight: Option<bool>,
    cursor_hide: Option<bool>,
    cursor_size: Option<String>,
```

Build the config after `audio_cfg` is resolved (near line ~598):

```rust
    let fx_cfg = fx::FxConfig {
        click_viz: click_viz.unwrap_or(false),
        keystrokes: keystrokes.unwrap_or(false),
        spotlight: spotlight.unwrap_or(false),
        cursor_hide: cursor_hide.unwrap_or(false),
        cursor_size: match cursor_size.as_deref() { Some("large") => 1, Some("xl") => 2, _ => 0 },
    };
```

Set `fx_cfg` + `fx: None` in the `ActiveRecording { ... }` initializer. Pass the real `draw_mouse` into seg0's `spawn_segment` (replace the `true` from Task 4):

```rust
    let seg0 = match spawn_segment(&app, target, FPS, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
```

- [ ] **Step 4: Start the FX session** once seg0 is patched into state. After the `orphan` block resolves and before `let _ = app.emit("recorder-started", ());`, start FX and store the session:

```rust
    // Start FX (overlay + input hooks) if any effect is enabled. Stored on the active
    // recording so stop/cancel can tear it down. Built here (not earlier) so the
    // overlay never lands in the countdown frames.
    if fx_cfg.needs_overlay() {
        let session = fx::start(&app, target, fx_cfg);
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        if let Some(rec) = guard.as_mut() { rec.fx = Some(session); }
        else { drop(guard); session.stop(&app); }
    }
```

Also set `fx_cfg` when building the preliminary `ActiveRecording` (Step 3) and add `fx: None`.

- [ ] **Step 5: Tear down FX on stop + cancel.** In `recorder_stop`, right after `windows::close_cam_bubble(&app);`, take and stop the session. Because `ActiveRecording` is moved out via `.take()` earlier, destructure `fx` from it:

In `recorder_stop`, change the destructure to include `fx`:

```rust
    let ActiveRecording { out_path, width, height, mut done, current, fx, .. } = rec;
    if let Some(session) = fx { session.stop(&app); }
```

In `recorder_cancel`, inside `if let Some(ActiveRecording { .. }) = rec`, add `fx` to the pattern and stop it:

```rust
    if let Some(ActiveRecording { mut done, current, out_path, fx, .. }) = rec {
        if let Some(session) = fx { session.stop(&app); }
```

- [ ] **Step 6: Live-toggle command.** Add to `mod.rs` (async because toggling overlay-drawn effects may rebuild/close the overlay window):

```rust
/// Live-toggle an overlay-drawn effect (click_viz | keystrokes | spotlight). Cursor
/// hide/size are start-time only (they change gdigrab args) and are rejected here.
/// Async: it may build/close the rec-fx window (window-build rule). Notifies the
/// control bar so its toggle reflects the change.
#[tauri::command(async)]
pub async fn recorder_set_fx(app: tauri::AppHandle, effect: String, on: bool) -> Result<(), String> {
    // Compute the resulting config under the lock; act on the window after unlocking.
    let (needs_overlay_before, cfg_after) = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        let rec = guard.as_mut().ok_or("not recording")?;
        let before = rec.fx_cfg.needs_overlay();
        match effect.as_str() {
            "click_viz" => rec.fx_cfg.click_viz = on,
            "keystrokes" => rec.fx_cfg.keystrokes = on,
            "spotlight" => rec.fx_cfg.spotlight = on,
            "cursor_hide" | "cursor_size" => return Err("cursor options are set at start".into()),
            other => return Err(format!("unknown effect: {other}")),
        }
        (before, rec.fx_cfg)
    };
    // Push the new config to the overlay so its renderers enable/disable instantly.
    let _ = app.emit_to(fx::window::FX_LABEL, "fx-config", serde_json::json!({
        "click_viz": cfg_after.click_viz,
        "keystrokes": cfg_after.keystrokes,
        "spotlight": cfg_after.spotlight,
    }));
    // If the overlay/hooks weren't running and now an effect needs them (or vice
    // versa), start/stop the session. Update hook config by restarting hooks.
    let target = { app.state::<RecorderState>().0.lock().unwrap().as_ref().map(|r| r.target) };
    if let Some(target) = target {
        let now_needs = cfg_after.needs_overlay();
        if now_needs && !needs_overlay_before {
            let session = fx::start(&app, target, cfg_after);
            if let Some(rec) = app.state::<RecorderState>().0.lock().unwrap().as_mut() { rec.fx = Some(session); }
        } else if !now_needs && needs_overlay_before {
            let taken = app.state::<RecorderState>().0.lock().unwrap().as_mut().and_then(|r| r.fx.take());
            if let Some(session) = taken { session.stop(&app); }
        } else if let Some(rec) = app.state::<RecorderState>().0.lock().unwrap().as_mut() {
            // Overlay stays; refresh the hook config so click/keystroke/spotlight
            // callbacks read the new flags. Restart hooks in place.
            if let Some(session) = rec.fx.take() { session.stop(&app); }
            rec.fx = Some(fx::start(&app, target, cfg_after));
        }
    }
    let _ = app.emit_to(windows::BAR_LABEL, "recorder-fx", serde_json::json!({ "effect": effect, "on": on }));
    Ok(())
}
```

- [ ] **Step 7: Extend `RecorderStatusDto`** and its construction with FX fields:

```rust
    pub click_viz: bool,
    pub keystrokes: bool,
    pub spotlight: bool,
    pub cursor_hide: bool,
    pub cursor_size: String,
```

In `recorder_status`, add to the mapped struct:

```rust
        click_viz: r.fx_cfg.click_viz,
        keystrokes: r.fx_cfg.keystrokes,
        spotlight: r.fx_cfg.spotlight,
        cursor_hide: r.fx_cfg.cursor_hide,
        cursor_size: match r.fx_cfg.cursor_size { 1 => "large".into(), 2 => "xl".into(), _ => "off".into() },
```

- [ ] **Step 8: Remove the spike.** Delete `recorder_fx_overlay_check` from `mod.rs` and its `lib.rs` registration. Register `recorder::recorder_set_fx,` in the `invoke_handler`.

- [ ] **Step 9: Build**

Run: `cd glint/src-tauri && cargo build 2>&1 | tail -20`
Expected: clean. Resolve any borrow/move errors around the `.take()`/lock patterns (keep MutexGuards dropped before any `.await` or `session.stop`).

- [ ] **Step 10: Commit**

```bash
git add glint/src-tauri/src/recorder/ glint/src-tauri/src/lib.rs
git commit -m "feat(p11): FX session lifecycle + recorder_start/stop/set_fx wiring"
```

---

## Task 8: Overlay renderers (clicks · keystrokes · spotlight)

**Files:**
- Create: `glint/src/recorder/fxRender.ts`
- Create: `glint/src/recorder/fxRender.test.ts`
- Modify: `glint/src/recorder/FxOverlay.tsx` (replace the spike pattern with the real render loop)
- Modify: `glint/src/recorder/recfx.css` (spotlight/chip styling if any DOM chrome)

**Interfaces:**
- Consumes: `fx-click {x,y,button}`, `fx-cursor {x,y}`, `fx-key {text,isModifier,down}`, `fx-config {click_viz,keystrokes,spotlight}` events (physical screen coords).
- Produces (pure, tested):
  - `function toCanvasXY(px: number, py: number, originX: number, originY: number, scale: number): { x: number; y: number }`
  - `function rippleRadius(ageMs: number, maxMs: number, maxR: number): number`
  - `function rippleAlpha(ageMs: number, maxMs: number): number`

- [ ] **Step 1: Write the failing test.** `glint/src/recorder/fxRender.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toCanvasXY, rippleRadius, rippleAlpha } from "./fxRender";

describe("fxRender", () => {
  it("maps physical screen coords to canvas-local device px", () => {
    // Overlay origin at (100,50) physical, DPR 2 → a point at (300,250) physical is
    // (200,200) physical-from-origin = (400,400) device px on the canvas.
    expect(toCanvasXY(300, 250, 100, 50, 2)).toEqual({ x: 400, y: 400 });
  });

  it("ripple grows with age and clamps at maxR", () => {
    expect(rippleRadius(0, 500, 40)).toBeCloseTo(0, 5);
    expect(rippleRadius(250, 500, 40)).toBeCloseTo(20, 5);
    expect(rippleRadius(1000, 500, 40)).toBeCloseTo(40, 5); // past maxMs clamps
  });

  it("ripple fades from 1 to 0 over its life", () => {
    expect(rippleAlpha(0, 500)).toBeCloseTo(1, 5);
    expect(rippleAlpha(500, 500)).toBeCloseTo(0, 5);
    expect(rippleAlpha(1000, 500)).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint && npx vitest run src/recorder/fxRender.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure helpers.** `glint/src/recorder/fxRender.ts`:

```ts
/** fxRender — pure geometry/animation math for the FX overlay canvas. */

/** Physical screen coords → device px on the overlay canvas (canvas covers the
 * recording area starting at originX/originY physical; canvas is sized in device px
 * = logical * scale, and we set canvas.width to innerWidth*dpr). */
export function toCanvasXY(px: number, py: number, originX: number, originY: number, scale: number) {
  return { x: (px - originX) * scale, y: (py - originY) * scale };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Ripple radius eases linearly 0→maxR over maxMs, then clamps. */
export function rippleRadius(ageMs: number, maxMs: number, maxR: number): number {
  return clamp01(ageMs / maxMs) * maxR;
}

/** Ripple opacity fades 1→0 over maxMs. */
export function rippleAlpha(ageMs: number, maxMs: number): number {
  return 1 - clamp01(ageMs / maxMs);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint && npx vitest run src/recorder/fxRender.test.ts 2>&1 | tail -20`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the overlay render loop.** Replace `FxOverlay.tsx` with the full renderer:

```tsx
/** FxOverlay (route #/rec-fx) — a transparent, click-through canvas the recorder
 * draws effects on; gdigrab records it. Listens for fx-* events from the input
 * hooks and animates click ripples, a cursor spotlight, and keystroke chips. */
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EMPTY_COMBO, reduceKey, visibleChips, type ComboState } from "./fxKeystrokeModel";
import { toCanvasXY, rippleRadius, rippleAlpha } from "./fxRender";
import "./recfx.css";

interface Ripple { x: number; y: number; born: number; button: string }
const RIPPLE_MS = 550;
const CHIP_TTL_MS = 1500;

export function FxOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let scale = 1, originX = 0, originY = 0;

    // Overlay covers the recording area; its window origin (physical) is our coord
    // origin, and devicePixelRatio maps physical→canvas device px.
    const win = getCurrentWindow();
    const syncGeom = async () => {
      scale = await win.scaleFactor();
      const pos = await win.outerPosition(); // physical, top-left of the overlay
      originX = pos.x; originY = pos.y;
      canvas.width = Math.round(window.innerWidth * scale);
      canvas.height = Math.round(window.innerHeight * scale);
    };
    void syncGeom();

    const cfg = { click_viz: true, keystrokes: true, spotlight: true };
    const ripples: Ripple[] = [];
    let cursor: { x: number; y: number } | null = null;
    let combo: ComboState = EMPTY_COMBO;

    const unlisteners: Array<Promise<() => void>> = [
      listen<{ x: number; y: number; button: string }>("fx-click", (e) => {
        if (cfg.click_viz) ripples.push({ ...e.payload, born: performance.now() });
      }),
      listen<{ x: number; y: number }>("fx-cursor", (e) => { cursor = e.payload; }),
      listen<{ text: string; isModifier: boolean; down: boolean }>("fx-key", (e) => {
        if (cfg.keystrokes) combo = reduceKey(combo, e.payload, performance.now());
      }),
      listen<{ click_viz: boolean; keystrokes: boolean; spotlight: boolean }>("fx-config", (e) => {
        cfg.click_viz = e.payload.click_viz;
        cfg.keystrokes = e.payload.keystrokes;
        cfg.spotlight = e.payload.spotlight;
      }),
    ];

    const draw = () => {
      const now = performance.now();
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Cursor spotlight — a soft radial halo under the pointer.
      if (cfg.spotlight && cursor) {
        const { x, y } = toCanvasXY(cursor.x, cursor.y, originX, originY, scale);
        const r = 60 * scale;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, "rgba(255,255,255,0.28)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      // Click ripples — expanding, fading rings.
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = now - rp.born;
        if (age > RIPPLE_MS) { ripples.splice(i, 1); continue; }
        const { x, y } = toCanvasXY(rp.x, rp.y, originX, originY, scale);
        const rad = rippleRadius(age, RIPPLE_MS, 42 * scale);
        ctx.globalAlpha = rippleAlpha(age, RIPPLE_MS);
        ctx.strokeStyle = rp.button === "right" ? "#ffb454" : "#5b7cfa";
        ctx.lineWidth = 3 * scale;
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Keystroke chips — a fixed bottom-center strip.
      const chips = cfg.keystrokes ? visibleChips(combo, now, CHIP_TTL_MS) : null;
      if (chips) drawChips(ctx, chips, canvas.width, canvas.height, scale);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    const onResize = () => { void syncGeom(); };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      unlisteners.forEach((p) => p.then((u) => u()).catch(() => {}));
    };
  }, []);

  return <canvas ref={canvasRef} className="fx-canvas" />;
}

/** Draw the key-cap chip strip centered near the bottom of the recording area. */
function drawChips(ctx: CanvasRenderingContext2D, chips: string[], w: number, h: number, scale: number) {
  ctx.font = `${20 * scale}px ui-monospace, monospace`;
  ctx.textBaseline = "middle";
  const padX = 14 * scale, gap = 8 * scale, chipH = 40 * scale;
  const widths = chips.map((c) => ctx.measureText(c).width + padX * 2);
  const total = widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1);
  let x = (w - total) / 2;
  const y = h - 70 * scale;
  chips.forEach((c, i) => {
    const cw = widths[i];
    ctx.fillStyle = "rgba(18,20,28,0.86)";
    roundRect(ctx, x, y, cw, chipH, 8 * scale); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1 * scale;
    roundRect(ctx, x, y, cw, chipH, 8 * scale); ctx.stroke();
    ctx.fillStyle = "#e8e8ee";
    ctx.fillText(c, x + padX, y + chipH / 2);
    x += cw + gap;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
```

- [ ] **Step 6: Typecheck + full vitest + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run 2>&1 | tail -15`
Expected: tsc clean; all vitest (existing + new) PASS.

- [ ] **Step 7: Commit**

```bash
git add glint/src/recorder/fxRender.ts glint/src/recorder/fxRender.test.ts glint/src/recorder/FxOverlay.tsx glint/src/recorder/recfx.css
git commit -m "feat(p11): FX overlay renderers — click ripples, spotlight, keystroke chips"
```

---

## Task 9: Cursor hide + size (overlay-drawn pointer)

**Files:**
- Modify: `glint/src/recorder/FxOverlay.tsx` (draw our own pointer when hidden/enlarged)
- Modify: `glint/src-tauri/src/recorder/fx/mod.rs` (pass cursor_hide/size to the overlay via an init event or query)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (emit cursor mode to the overlay on FX start)

**Interfaces:**
- Consumes: `fx-cursor {x,y}` (already emitted when hide/size active — see hooks Task 6), plus a new `fx-cursor-mode {hide: bool, size: number}` init event so the overlay knows to draw a pointer.
- Produces: overlay renders a scaled pointer sprite at the cursor when `hide || size>0`.

> **Honest caveat (from the spec):** faithful scaled *system* cursor rendering (capturing the live `HCURSOR`) is the fiddliest piece. This task ships the **stylized pointer sprite** fallback first (always correct, shape-agnostic); capturing the real HCURSOR is a follow-up only if the sprite reads poorly at-screen.

- [ ] **Step 1: Emit the cursor mode on FX start.** In `recorder/mod.rs`, right after `fx::start(...)` stores the session in `recorder_start`, emit the mode to the overlay:

```rust
    let _ = app.emit_to(fx::window::FX_LABEL, "fx-cursor-mode", serde_json::json!({
        "hide": fx_cfg.cursor_hide, "size": fx_cfg.cursor_size
    }));
```

(The overlay may cold-load after this fires; also have the overlay request it. Simplest robust path: re-emit inside a short retry, OR the overlay falls back to defaults until the event arrives. Use the fallback: default `hide=false,size=0` until the event lands, and additionally re-emit once ~400ms later.)

Add the delayed re-emit after the first emit:

```rust
    { let app2 = app.clone(); let hide = fx_cfg.cursor_hide; let size = fx_cfg.cursor_size;
      tauri::async_runtime::spawn(async move {
          tokio::time::sleep(std::time::Duration::from_millis(400)).await;
          let _ = app2.emit_to(fx::window::FX_LABEL, "fx-cursor-mode", serde_json::json!({ "hide": hide, "size": size }));
      }); }
```

- [ ] **Step 2: Draw the pointer in the overlay.** In `FxOverlay.tsx`, add cursor-mode state and a pointer draw. Add near the other `let` decls in the effect:

```tsx
    let cursorMode = { hide: false, size: 0 };
```

Add a listener to the `unlisteners` array:

```tsx
      listen<{ hide: boolean; size: number }>("fx-cursor-mode", (e) => { cursorMode = e.payload; }),
```

In `draw()`, after the spotlight block, add (before ripples):

```tsx
      // Overlay-drawn pointer for cursor hide/size. gdigrab's own cursor is off
      // (draw_mouse 0) in these modes, so we render one. Sprite scales with size.
      if ((cursorMode.hide || cursorMode.size > 0) && cursor) {
        const { x, y } = toCanvasXY(cursor.x, cursor.y, originX, originY, scale);
        const mag = cursorMode.size === 2 ? 2.2 : cursorMode.size === 1 ? 1.6 : 1;
        drawPointer(ctx, x, y, scale * mag);
      }
```

Add the sprite fn at file scope:

```tsx
/** A stylized arrow pointer (device px), tip at x,y. Shape-agnostic fallback for
 * cursor hide/size when the OS cursor is turned off in the capture. */
function drawPointer(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 16 * s);
  ctx.lineTo(4 * s, 12 * s);
  ctx.lineTo(7 * s, 18 * s);
  ctx.lineTo(9 * s, 17 * s);
  ctx.lineTo(6 * s, 11 * s);
  ctx.lineTo(11 * s, 11 * s);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.2 * s;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 3: Typecheck + build**

Run: `cd glint && npx tsc --noEmit && cd src-tauri && cargo build 2>&1 | tail -8`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/recorder/FxOverlay.tsx glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p11): overlay-drawn pointer for cursor hide/size"
```

---

## Task 10: UI — selector chips, control-bar toggles, settings, IPC wrappers

**Files:**
- Modify: `glint/src/lib/recorder.ts` (`recorderSetFx`, status fields, start params)
- Modify: `glint/src/recorder/RegionSelect.tsx` (FX chips)
- Modify: `glint/src/recorder/ControlBar.tsx` (live FX toggles)
- Modify: the Settings view (FX default toggles) — find via grep in Step 4
- Modify: `glint/src/recorder/ControlBar.test.ts` if it asserts status shape

**Interfaces:**
- Consumes: `recorder_set_fx`, `recorder_status` (FX fields), `recorder_start` (FX params).
- Produces: `recorderSetFx(effect, on)`, extended `RecorderStatus`, FX-aware `recorderStartRegion/Fullscreen`.

- [ ] **Step 1: Extend `lib/recorder.ts`.** Add FX fields to `RecorderStatus`:

```ts
  click_viz: boolean;
  keystrokes: boolean;
  spotlight: boolean;
  cursor_hide: boolean;
  cursor_size: "off" | "large" | "xl";
```

Add an `fx` param bag to the start wrappers and forward it. Replace the two start fns:

```ts
export interface FxOpts {
  click_viz?: boolean; keystrokes?: boolean; spotlight?: boolean;
  cursor_hide?: boolean; cursor_size?: "off" | "large" | "xl";
}

export const recorderStartFullscreen = (
  audio?: { system: boolean; mic: boolean; webcam: boolean },
  fx?: FxOpts,
): Promise<void> =>
  invoke<void>("recorder_start", {
    mode: "fullscreen",
    system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false,
    click_viz: fx?.click_viz ?? false, keystrokes: fx?.keystrokes ?? false,
    spotlight: fx?.spotlight ?? false, cursor_hide: fx?.cursor_hide ?? false,
    cursor_size: fx?.cursor_size ?? "off",
  });

export const recorderStartRegion = (
  r: { x: number; y: number; w: number; h: number },
  audio?: { system: boolean; mic: boolean; webcam: boolean },
  fx?: FxOpts,
): Promise<void> =>
  invoke<void>("recorder_start", {
    mode: "region", x: r.x, y: r.y, w: r.w, h: r.h,
    system: audio?.system ?? true, mic: audio?.mic ?? false, webcam: audio?.webcam ?? false,
    click_viz: fx?.click_viz ?? false, keystrokes: fx?.keystrokes ?? false,
    spotlight: fx?.spotlight ?? false, cursor_hide: fx?.cursor_hide ?? false,
    cursor_size: fx?.cursor_size ?? "off",
  });

export const recorderSetFx = (effect: "click_viz" | "keystrokes" | "spotlight", on: boolean): Promise<void> =>
  invoke<void>("recorder_set_fx", { effect, on });
```

- [ ] **Step 2: Selector chips.** In `RegionSelect.tsx`, add state seeded from settings (near the `sys/mic/cam` state, ~line 72):

```tsx
  const [clickViz, setClickViz] = useState(false);
  const [keystrokes, setKeystrokes] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [cursorHide, setCursorHide] = useState(false);
  const [cursorSize, setCursorSize] = useState<"off" | "large" | "xl">("off");
```

In the settings-seeding effect (~line 77) add:

```tsx
      setClickViz(settings.record_click_viz ?? false);
      setKeystrokes(settings.record_keystrokes ?? false);
      setSpotlight(settings.record_cursor_spotlight ?? false);
      setCursorHide(settings.record_cursor_hide ?? false);
      setCursorSize(settings.record_cursor_size ?? "off");
```

Pass the fx bag into BOTH start calls (region ~line 102 and fullscreen ~line 108) as a 3rd arg:

```tsx
    }, { system: sys, mic, webcam: cam },
       { click_viz: clickViz, keystrokes, spotlight, cursor_hide: cursorHide, cursor_size: cursorSize })
```

Add the deps to the `useCallback` dependency arrays (`clickViz, keystrokes, spotlight, cursorHide, cursorSize`).

Add chips next to the existing sys/mic/cam chips (mirror their markup — use `lucide-react` icons `MousePointerClick`, `Keyboard`, `Sun`; import them). Example for click viz:

```tsx
        <button
          className={`rec-sel-chip${clickViz ? "" : " rec-sel-chip--off"}`}
          onClick={() => setClickViz((v) => !v)}
        >
          <MousePointerClick size={14} /> Clicks
        </button>
```

Add analogous chips for Keystrokes (`keystrokes`/`setKeystrokes`), Spotlight (`spotlight`/`setSpotlight`), Hide cursor (`cursorHide`/`setCursorHide`), and a size cycle button (`off→large→xl`) for `cursorSize`.

- [ ] **Step 3: Control-bar live toggles.** In `ControlBar.tsx`, add FX state seeded from status and toggles for click/keystroke/spotlight (hide/size shown read-only). Add to the status load (~line 27):

```tsx
          setFx({ clickViz: s.click_viz, keystrokes: s.keystrokes, spotlight: s.spotlight });
```

Add state + a toggle:

```tsx
  const [fx, setFx] = useState<{ clickViz: boolean; keystrokes: boolean; spotlight: boolean } | null>(null);

  async function toggleFx(effect: "click_viz" | "keystrokes" | "spotlight", next: boolean) {
    try { await recorderSetFx(effect, next); } catch { return; }
    setFx((f) => f && {
      ...f,
      clickViz: effect === "click_viz" ? next : f.clickViz,
      keystrokes: effect === "keystrokes" ? next : f.keystrokes,
      spotlight: effect === "spotlight" ? next : f.spotlight,
    });
  }
```

Listen for `recorder-fx` (mirrors the `recorder-webcam` pattern) to keep the bar in sync. Render three `rec-atog` buttons (icons `MousePointerClick`, `Keyboard`, `Sun`) driven by `fx?.clickViz` etc., calling `toggleFx`. Import `recorderSetFx` from `../lib/recorder`.

- [ ] **Step 4: Settings defaults UI.** Find the recorder settings block: `cd glint && grep -rn "record_webcam\|record_microphone" src/views src/components`. In the same section that toggles `record_webcam`, add toggles for `record_click_viz`, `record_keystrokes`, `record_cursor_spotlight`, `record_cursor_hide`, and a select/cycle for `record_cursor_size` (off/large/xl), each calling the existing settings-update path used by `record_webcam`.

- [ ] **Step 5: Fix any status-shape test.** If `ControlBar.test.ts` builds a `RecorderStatus`, add the 5 FX fields so it typechecks.

- [ ] **Step 6: Typecheck + full test + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run 2>&1 | tail -12 && cd src-tauri && cargo test 2>&1 | tail -12`
Expected: tsc clean; all vitest PASS; all cargo tests PASS.

- [ ] **Step 7: Commit**

```bash
git add glint/src/lib/recorder.ts glint/src/recorder/RegionSelect.tsx glint/src/recorder/ControlBar.tsx glint/src/recorder/ControlBar.test.ts glint/src/views/ glint/src/components/
git commit -m "feat(p11): FX chips, control-bar toggles, settings defaults, IPC wrappers"
```

---

## Task 11: Green gate + isolation check + at-screen acceptance

**Files:** none (verification only), plus `docs/superpowers/ROADMAP.md` update.

- [ ] **Step 1: Full green gate.**

Run:
```
cd glint/src-tauri && cargo test 2>&1 | tail -15
cd glint && npx vitest run 2>&1 | tail -15
cd glint && npx tsc --noEmit
cd glint/src-tauri && cargo build 2>&1 | tail -5
```
Expected: all green.

- [ ] **Step 2: Recorder isolation greps (must be empty).**

Run:
```
cd glint/src-tauri/src && grep -rnE "use .*(capture|editor|overlay|ocr)::" recorder/ ; echo "exit: $?"
grep -rnE "use .*recorder::" ocr/ ; echo "exit: $?"
```
Expected: no matches from `recorder/` into capture/editor/overlay/ocr, and none from `ocr/` into recorder. (`grep` exit 1 = clean.)

- [ ] **Step 3: At-screen acceptance (MANUAL).** Kill stray instances (`Stop-Process -Name glint -Force`), `npm run tauri dev`, then for a region and a fullscreen recording verify:
  - Clicks show ripples (left = accent blue, right = amber); no click is swallowed by the overlay.
  - Keystrokes appear as chips bottom-center, modifier combos grouped (`Ctrl Shift S`), fading after idle.
  - Spotlight halo follows the cursor.
  - Cursor **hide** removes the OS cursor from the recording and shows our pointer; **size** large/xl enlarges it.
  - Control-bar toggles for clicks/keystrokes/spotlight take effect mid-recording; hide/size are fixed (start-time).
  - On Stop/Cancel the overlay disappears and no `rec-fx` window lingers; a second recording still works (hooks fully torn down).

- [ ] **Step 4: Update ROADMAP.** In `docs/superpowers/ROADMAP.md`, move the "Click & keystroke highlighting" and "Cursor highlight / spotlight, cursor hide, and cursor-size" bullets out of "Deferred CleanShot video-polish" into a new **Phase 11 — Recording FX** entry under **Shipped**, summarizing the mechanism (click-through gdigrab-captured overlay + LL input hooks; baked-in; isolation honored). Leave "Independent webcam layer" in Planned.

- [ ] **Step 5: Commit + merge to master.**

```bash
git add docs/superpowers/ROADMAP.md
git commit -m "docs(p11): mark Recording FX shipped in the roadmap"
git checkout master && git merge --no-ff phase-11-recording-fx -m "Merge Phase 11 — Recording FX (clicks/keystrokes/cursor)"
```

---

## Self-Review Notes

- **Spec coverage:** click viz (T6 hook + T8 render), keystroke overlay bottom-center (T2 keymap + T3 model + T8 render), spotlight (T6 + T8), cursor hide/size (T4 draw_mouse + T7 config + T9 pointer), live-vs-start-time rule (T7 `recorder_set_fx` rejects cursor toggles), settings/chips/control-bar (T1/T10), isolation (T2 module placement + T11 grep), gdigrab-capture risk spike (T5), privacy (T6 hooks only when enabled + torn down T7).
- **Type consistency:** `FxConfig` fields (`click_viz/keystrokes/spotlight/cursor_hide/cursor_size:u8`) consistent across T6/T7/T9; frontend `fx-*` event shapes match between hook emits (T6) and overlay listeners (T8/T9); `recorderSetFx` effect strings (`click_viz|keystrokes|spotlight`) match the Rust `recorder_set_fx` match arms (T7).
- **Known softest spots (flagged for reviewer):** T6 hook thread-local/emit pattern and the exact `windows` 0.62 API paths (verify against the crate at build); T7 lock/`.take()`/`await` ordering (MutexGuard must drop before `session.stop`/`.await`); T9 scaled-cursor is the sprite fallback by design.
