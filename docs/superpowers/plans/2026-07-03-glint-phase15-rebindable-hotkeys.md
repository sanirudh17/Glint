# Rebindable Hotkeys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Glint's five global shortcuts rebindable from the Settings → Hotkeys panel, with click-to-capture, validation, live OS re-registration, reset/clear, and in-app instructions.

**Architecture:** A pure Rust validation core (`settings/hotkeys.rs`) and a pure TS key-mapper (`lib/hotkeys.ts`) are unit-tested in isolation. Two new commands (`settings_set_hotkey`, `settings_reset_hotkeys`) validate → mutate in-memory `Settings` → re-register global shortcuts via a refactored `shortcuts.rs`, rolling back on OS conflict. Two more commands (`hotkeys_suspend`/`hotkeys_resume`) let the panel disarm shortcuts while capturing keys. The frontend Hotkeys panel is rewritten to a capture-driven list; persistence rides the existing SQLite `settings` table (`persistSetting("hotkeys", …)`).

**Tech Stack:** Rust, Tauri v2 (`tauri-plugin-global-shortcut`), React 19 + TypeScript, Zustand, Vitest, Cargo tests, SQLite (`tauri-plugin-sql`).

## Global Constraints

- **Local-first / single-user:** no cloud, accounts, auth, or network calls. Shortcuts persist only to the local SQLite `settings` table.
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*` import nothing from `capture/`/`editor/`/`overlay/`/`ocr/`; `ocr/` imports nothing from `recorder/`. This phase touches `settings/`, `shortcuts.rs`, `lib.rs`, and the settings UI — **never** `recorder/`. The `record` shortcut's *handler* is unchanged; only its accelerator string can change. The green gate re-verifies with greps.
- **Tauri v2 IPC casing:** `invoke` arg keys are camelCase → snake_case Rust params. All new command args are single-word (`action`, `accelerator`) — no multi-word-key hazard.
- **Window rules:** global-shortcut register/unregister run on the calling thread (no webview build) — safe from a command. Toasts/feedback must be visible (never silent).
- **Base branch:** work on `phase-15-rebindable-hotkeys`, merge to `master`.
- **Modifier rule (verbatim):** every shortcut must include at least one of **Ctrl / Alt / Win**; Shift-only or bare keys are rejected. Empty accelerator = cleared/disabled (allowed).

---

### Task 1: Pure hotkey core — validation, dedupe, field access (Rust)

**Files:**
- Create: `glint/src-tauri/src/settings/hotkeys.rs`
- Modify: `glint/src-tauri/src/settings/mod.rs` (add `pub mod hotkeys;`)
- Test: inline `#[cfg(test)]` in `hotkeys.rs`

**Interfaces:**
- Consumes: `crate::settings::Hotkeys` (existing struct in `settings/mod.rs`).
- Produces:
  - `pub const HOTKEY_ACTIONS: [&str; 5]`
  - `pub enum HotkeyError { Empty, NoModifier, BadKey(String), Duplicate(String) }` (derives `Debug, PartialEq`)
  - `pub fn validate_accelerator(accel: &str) -> Result<(), HotkeyError>`
  - `pub fn duplicate_of(h: &Hotkeys, action: &str, accel: &str) -> Option<String>` (returns the conflicting **action key**)
  - `pub fn get_field<'a>(h: &'a Hotkeys, action: &str) -> Option<&'a str>`
  - `pub fn set_field(h: &mut Hotkeys, action: &str, accel: String) -> bool`

- [ ] **Step 1: Write the failing tests**

Create `glint/src-tauri/src/settings/hotkeys.rs` with the test module first:

```rust
//! Pure hotkey helpers: the rebindable action list, accelerator validation, and
//! duplicate detection. No Tauri types — unit-tested in isolation.

use super::Hotkeys;

#[cfg(test)]
mod tests {
    use super::*;

    fn hk() -> Hotkeys {
        Hotkeys {
            capture_area: "CmdOrCtrl+Shift+1".into(),
            capture_window: "CmdOrCtrl+Shift+2".into(),
            capture_fullscreen: "CmdOrCtrl+Shift+3".into(),
            record: "CmdOrCtrl+Shift+5".into(),
            copy_path: "CmdOrCtrl+Shift+C".into(),
        }
    }

    #[test]
    fn valid_combo_with_ctrl_ok() {
        assert!(validate_accelerator("Ctrl+Shift+4").is_ok());
        assert!(validate_accelerator("Alt+A").is_ok());
        assert!(validate_accelerator("Super+F5").is_ok());
        assert!(validate_accelerator("CmdOrCtrl+Shift+1").is_ok());
    }

    #[test]
    fn shift_only_or_bare_rejected() {
        assert_eq!(validate_accelerator("Shift+A"), Err(HotkeyError::NoModifier));
        assert_eq!(validate_accelerator("A"), Err(HotkeyError::NoModifier));
    }

    #[test]
    fn empty_is_empty_error() {
        assert_eq!(validate_accelerator("  "), Err(HotkeyError::Empty));
    }

    #[test]
    fn unknown_key_rejected() {
        assert!(matches!(validate_accelerator("Ctrl+Foo"), Err(HotkeyError::BadKey(_))));
    }

    #[test]
    fn needs_exactly_one_main_key() {
        assert!(matches!(validate_accelerator("Ctrl+A+B"), Err(HotkeyError::BadKey(_))));
        assert!(matches!(validate_accelerator("Ctrl+Alt"), Err(HotkeyError::BadKey(_))));
    }

    #[test]
    fn punctuation_and_fkeys_ok() {
        for a in ["Ctrl+/", "Ctrl+.", "Ctrl+-", "Ctrl+[", "Alt+F12"] {
            assert!(validate_accelerator(a).is_ok(), "{a} should be valid");
        }
    }

    #[test]
    fn duplicate_detected_order_insensitive() {
        let h = hk();
        // Shift+Ctrl+2 == capture_window's CmdOrCtrl+Shift+2
        assert_eq!(duplicate_of(&h, "record", "Shift+Ctrl+2").as_deref(), Some("capture_window"));
        // Rebinding an action to its OWN current value is not a duplicate.
        assert_eq!(duplicate_of(&h, "capture_window", "Ctrl+Shift+2"), None);
        // A fresh combo collides with nothing.
        assert_eq!(duplicate_of(&h, "record", "Ctrl+Shift+9"), None);
    }

    #[test]
    fn get_set_field_roundtrip() {
        let mut h = hk();
        assert_eq!(get_field(&h, "record"), Some("CmdOrCtrl+Shift+5"));
        assert!(set_field(&mut h, "record", "Ctrl+Shift+9".into()));
        assert_eq!(get_field(&h, "record"), Some("Ctrl+Shift+9"));
        assert!(!set_field(&mut h, "nope", "x".into()));
        assert_eq!(get_field(&h, "nope"), None);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint/src-tauri && cargo test hotkeys::`
Expected: FAIL to compile — `validate_accelerator`/`duplicate_of`/`get_field`/`set_field`/`HotkeyError`/`HOTKEY_ACTIONS` don't exist.

- [ ] **Step 3: Implement the core**

Add above the `#[cfg(test)]` module in `hotkeys.rs`:

```rust
pub const HOTKEY_ACTIONS: [&str; 5] =
    ["capture_area", "capture_window", "capture_fullscreen", "record", "copy_path"];

#[derive(Debug, PartialEq)]
pub enum HotkeyError {
    Empty,
    NoModifier,
    BadKey(String),
    Duplicate(String), // conflicting action key
}

/// Any modifier token (case-insensitive), including Shift.
fn is_modifier(tok: &str) -> bool {
    matches!(
        tok.to_ascii_lowercase().as_str(),
        "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" | "cmd" | "command"
            | "alt" | "option" | "super" | "win" | "meta" | "shift"
    )
}

/// A "real" modifier that qualifies a global shortcut (Shift alone does not).
fn is_real_modifier(tok: &str) -> bool {
    is_modifier(tok) && !tok.eq_ignore_ascii_case("shift")
}

/// Known non-modifier main keys (matches the frontend mapper's output tokens).
fn is_valid_key(tok: &str) -> bool {
    let u = tok.to_ascii_uppercase();
    if u.len() == 1 {
        let b = u.as_bytes()[0];
        if b.is_ascii_alphanumeric() {
            return true; // A-Z, 0-9
        }
    }
    if let Some(n) = u.strip_prefix('F') {
        if let Ok(num) = n.parse::<u32>() {
            return (1..=24).contains(&num); // F1-F24
        }
    }
    matches!(
        u.as_str(),
        "SPACE" | "TAB" | "ENTER" | "UP" | "DOWN" | "LEFT" | "RIGHT"
            | "-" | "=" | "," | "." | "/" | "\\" | ";" | "'" | "[" | "]" | "`"
    )
}

pub fn validate_accelerator(accel: &str) -> Result<(), HotkeyError> {
    if accel.trim().is_empty() {
        return Err(HotkeyError::Empty);
    }
    let toks: Vec<&str> = accel.split('+').map(|t| t.trim()).filter(|t| !t.is_empty()).collect();
    let mut has_real_mod = false;
    let mut key_count = 0;
    for t in &toks {
        if is_modifier(t) {
            if is_real_modifier(t) {
                has_real_mod = true;
            }
        } else if is_valid_key(t) {
            key_count += 1;
        } else {
            return Err(HotkeyError::BadKey((*t).to_string()));
        }
    }
    if key_count != 1 {
        return Err(HotkeyError::BadKey(format!("expected one key, got {key_count}")));
    }
    if !has_real_mod {
        return Err(HotkeyError::NoModifier);
    }
    Ok(())
}

/// Normalized comparable form: uppercase tokens, modifier aliases folded, sorted.
fn normalize(accel: &str) -> String {
    let mut toks: Vec<String> = accel
        .split('+')
        .map(|t| {
            let u = t.trim().to_ascii_uppercase();
            match u.as_str() {
                "CMDORCTRL" | "COMMANDORCONTROL" | "CONTROL" => "CTRL".to_string(),
                "OPTION" => "ALT".to_string(),
                "WIN" | "META" | "CMD" | "COMMAND" | "SUPER" => "SUPER".to_string(),
                _ => u,
            }
        })
        .filter(|t| !t.is_empty())
        .collect();
    toks.sort();
    toks.join("+")
}

pub fn get_field<'a>(h: &'a Hotkeys, action: &str) -> Option<&'a str> {
    Some(match action {
        "capture_area" => h.capture_area.as_str(),
        "capture_window" => h.capture_window.as_str(),
        "capture_fullscreen" => h.capture_fullscreen.as_str(),
        "record" => h.record.as_str(),
        "copy_path" => h.copy_path.as_str(),
        _ => return None,
    })
}

pub fn set_field(h: &mut Hotkeys, action: &str, accel: String) -> bool {
    match action {
        "capture_area" => h.capture_area = accel,
        "capture_window" => h.capture_window = accel,
        "capture_fullscreen" => h.capture_fullscreen = accel,
        "record" => h.record = accel,
        "copy_path" => h.copy_path = accel,
        _ => return false,
    }
    true
}

/// If `accel` (normalized) equals any OTHER action's binding, return that action key.
pub fn duplicate_of(h: &Hotkeys, action: &str, accel: &str) -> Option<String> {
    let target = normalize(accel);
    for other in HOTKEY_ACTIONS {
        if other == action {
            continue;
        }
        if let Some(v) = get_field(h, other) {
            if !v.is_empty() && normalize(v) == target {
                return Some(other.to_string());
            }
        }
    }
    None
}
```

- [ ] **Step 4: Declare the module**

In `glint/src-tauri/src/settings/mod.rs`, next to the existing `pub mod commands;` / `pub mod hydrate;` lines, add:

```rust
pub mod hotkeys;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd glint/src-tauri && cargo test hotkeys::`
Expected: PASS (8 tests). Dead-code warnings for not-yet-used fns are fine.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/settings/hotkeys.rs glint/src-tauri/src/settings/mod.rs
git commit -m "feat(p15): pure hotkey validation + dedupe core (Rust, tested)"
```

---

### Task 2: Pure key-event mapper (TypeScript)

**Files:**
- Create: `glint/src/lib/hotkeys.ts`
- Test: `glint/src/lib/hotkeys.test.ts`

**Interfaces:**
- Produces:
  - `export function keyEventToAccelerator(e: KeyboardEvent): string | null` — Tauri accelerator (`"Ctrl+Shift+1"`) or `null` while only modifiers are held / key unsupported.
  - `export function toChips(accel: string): string[]` — display chips (`["Ctrl","Shift","1"]`).

- [ ] **Step 1: Write the failing tests**

Create `glint/src/lib/hotkeys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { keyEventToAccelerator, toChips } from "./hotkeys";

// Minimal KeyboardEvent-like stub (only the fields the mapper reads).
function ev(code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}): KeyboardEvent {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint && npx vitest run src/lib/hotkeys.test.ts`
Expected: FAIL — `./hotkeys` module not found.

- [ ] **Step 3: Implement the mapper**

Create `glint/src/lib/hotkeys.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd glint && npx vitest run src/lib/hotkeys.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add glint/src/lib/hotkeys.ts glint/src/lib/hotkeys.test.ts
git commit -m "feat(p15): pure key-event → accelerator mapper (TS, tested)"
```

---

### Task 3: Re-registration infra in `shortcuts.rs`

**Files:**
- Modify: `glint/src-tauri/src/shortcuts.rs`

**Interfaces:**
- Consumes: existing `SettingsState`, `crate::capture`, `crate::recorder`, `crate::window`, `crate::clipboard` (all already used by the current `register`).
- Produces:
  - `pub fn register(app: &AppHandle) -> tauri::Result<()>` (unchanged signature; now tolerant wrapper over `apply`).
  - `pub fn reapply(app: &AppHandle, strict: bool) -> Result<(), String>` — unregister all, then register from current settings; in `strict` mode returns `Err` on the first accelerator the OS rejects.
  - `pub fn unregister_all(app: &AppHandle)` — clear all global shortcuts.

- [ ] **Step 1: Rewrite `shortcuts.rs` around a shared `apply`**

Replace the body of `glint/src-tauri/src/shortcuts.rs` (keep the imports; add nothing recorder-related) with:

```rust
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::commands::SettingsState;
use crate::window;

/// Register global shortcuts from settings at startup. Tolerant: a bad/conflicting
/// accelerator is logged and skipped, never fatal.
pub fn register(app: &AppHandle) -> tauri::Result<()> {
    let _ = apply(app, false);
    Ok(())
}

/// Clear every registered global shortcut. Safe to call when none are registered.
pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

/// Re-apply shortcuts from the CURRENT settings (used after a rebind). Clears first so it
/// is idempotent. `strict` = return Err on the first accelerator the OS rejects (so the
/// caller can roll back); otherwise log + skip (startup / rollback re-arm).
pub fn reapply(app: &AppHandle, strict: bool) -> Result<(), String> {
    apply(app, strict)
}

fn apply(app: &AppHandle, strict: bool) -> Result<(), String> {
    // Idempotent: drop everything, then re-add from settings.
    let _ = app.global_shortcut().unregister_all();

    let hotkeys = {
        let state = app.state::<SettingsState>();
        let settings = state.0.lock().unwrap();
        let h = &settings.hotkeys;
        [
            (h.capture_area.clone(), "capture_area"),
            (h.capture_window.clone(), "capture_window"),
            (h.capture_fullscreen.clone(), "capture_fullscreen"),
            (h.record.clone(), "record"),
            (h.copy_path.clone(), "copy_path"),
        ]
    };

    for (accel, action) in hotkeys {
        // An empty accelerator means the user cleared/disabled this shortcut.
        if accel.trim().is_empty() {
            log::info!("Shortcut '{action}' is cleared — skipping registration");
            continue;
        }
        let action_name = action; // &'static str
        let result = app.global_shortcut().on_shortcut(
            accel.as_str(),
            move |handle, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    match action_name {
                        "capture_area" => {
                            crate::capture::begin_spawned(handle, crate::capture::CaptureMode::Area);
                        }
                        "capture_window" => {
                            crate::capture::begin_spawned(handle, crate::capture::CaptureMode::Window);
                        }
                        "capture_fullscreen" => {
                            crate::capture::begin_spawned(handle, crate::capture::CaptureMode::Fullscreen);
                        }
                        "record" => {
                            let h = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = crate::recorder::recorder_open_region_selector(h).await;
                            });
                        }
                        "copy_path" => {
                            let path = handle
                                .state::<crate::capture::LastCaptureState>()
                                .0
                                .lock()
                                .unwrap()
                                .as_ref()
                                .map(|l| l.path.clone());
                            let msg = match path {
                                Some(p) => match crate::clipboard::copy_text(&p) {
                                    Ok(()) => "Path copied",
                                    Err(e) => {
                                        log::warn!("copy_path failed: {e}");
                                        "Couldn't copy path"
                                    }
                                },
                                None => "No capture to copy yet",
                            };
                            let _ = handle.emit("glint-toast", msg);
                        }
                        other => {
                            window::focus_main(handle);
                            let _ = handle.emit("shortcut-fired", other);
                        }
                    }
                }
            },
        );

        match result {
            Ok(()) => log::info!("Registered global shortcut: {accel} -> {action_name}"),
            Err(e) => {
                log::warn!("Failed to register '{accel}' for '{action_name}': {e}");
                if strict {
                    return Err("That shortcut is in use by another app.".to_string());
                }
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: Build to confirm it compiles**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build
```
Expected: builds. Dead-code warnings for `reapply`/`unregister_all` (used in Task 4) are fine.

- [ ] **Step 3: Commit**

```bash
git add glint/src-tauri/src/shortcuts.rs
git commit -m "feat(p15): shortcuts reapply/unregister_all + strict registration"
```

---

### Task 4: Hotkey commands + registration

**Files:**
- Modify: `glint/src-tauri/src/settings/commands.rs` (add four commands)
- Modify: `glint/src-tauri/src/lib.rs` (register the four commands in `invoke_handler`)

**Interfaces:**
- Consumes: `crate::settings::hotkeys::{HOTKEY_ACTIONS, HotkeyError, validate_accelerator, duplicate_of, get_field, set_field}` (Task 1); `crate::shortcuts::reapply`/`unregister_all` (Task 3); `SettingsState` + `Settings` (existing).
- Produces (registered commands): `settings_set_hotkey`, `settings_reset_hotkeys`, `hotkeys_suspend`, `hotkeys_resume`.

- [ ] **Step 1: Add the commands**

Append to `glint/src-tauri/src/settings/commands.rs` (the `use` lines go at the top with the others):

```rust
use tauri::AppHandle; // `State` is already imported at the top of commands.rs

use super::hotkeys::{self, HotkeyError, HOTKEY_ACTIONS};
use super::Hotkeys;

/// User-facing label for an action key (matches the Hotkeys panel labels).
fn action_label(action: &str) -> String {
    match action {
        "capture_area" => "Capture area",
        "capture_window" => "Capture window",
        "capture_fullscreen" => "Capture fullscreen",
        "record" => "Record",
        "copy_path" => "Copy path",
        _ => action,
    }
    .to_string()
}

fn friendly(e: HotkeyError) -> String {
    match e {
        HotkeyError::Empty => "Shortcut is empty.".to_string(),
        HotkeyError::NoModifier => "Add Ctrl, Alt, or Win to the shortcut.".to_string(),
        HotkeyError::BadKey(_) => "That key can't be used in a shortcut.".to_string(),
        HotkeyError::Duplicate(a) => format!("Already used by {a}."),
    }
}

/// Rebind one action. Validates → dedupe → write in-memory → re-register with the OS.
/// On OS conflict, rolls back the previous binding (and re-arms it) and returns a message.
/// An empty `accelerator` clears/disables the shortcut. Returns the updated Settings.
#[tauri::command]
pub fn settings_set_hotkey(
    app: AppHandle,
    state: State<SettingsState>,
    action: String,
    accelerator: String,
) -> Result<Settings, String> {
    if !HOTKEY_ACTIONS.contains(&action.as_str()) {
        return Err(format!("Unknown action: {action}"));
    }
    let accel = accelerator.trim().to_string();
    if !accel.is_empty() {
        hotkeys::validate_accelerator(&accel).map_err(friendly)?;
    }

    let old = {
        let mut s = state.0.lock().unwrap();
        if !accel.is_empty() {
            if let Some(other) = hotkeys::duplicate_of(&s.hotkeys, &action, &accel) {
                return Err(friendly(HotkeyError::Duplicate(action_label(&other))));
            }
        }
        let old = hotkeys::get_field(&s.hotkeys, &action).unwrap_or("").to_string();
        hotkeys::set_field(&mut s.hotkeys, &action, accel.clone());
        old
    }; // lock dropped before reapply (which re-locks SettingsState)

    match crate::shortcuts::reapply(&app, true) {
        Ok(()) => Ok(state.0.lock().unwrap().clone()),
        Err(msg) => {
            {
                let mut s = state.0.lock().unwrap();
                hotkeys::set_field(&mut s.hotkeys, &action, old);
            }
            let _ = crate::shortcuts::reapply(&app, false); // re-arm the previous set
            Err(msg)
        }
    }
}

/// Restore all five shortcuts to their defaults, re-register, return updated Settings.
#[tauri::command]
pub fn settings_reset_hotkeys(app: AppHandle, state: State<SettingsState>) -> Result<Settings, String> {
    {
        let mut s = state.0.lock().unwrap();
        s.hotkeys = Hotkeys::default();
    }
    let _ = crate::shortcuts::reapply(&app, false);
    Ok(state.0.lock().unwrap().clone())
}

/// Temporarily disarm all global shortcuts (while the panel is capturing a key press, so
/// pressing e.g. Ctrl+Shift+1 to rebind doesn't fire the capture action).
#[tauri::command]
pub fn hotkeys_suspend(app: AppHandle) {
    crate::shortcuts::unregister_all(&app);
}

/// Re-arm all global shortcuts from current settings (after capture ends / on cancel).
#[tauri::command]
pub fn hotkeys_resume(app: AppHandle) {
    let _ = crate::shortcuts::reapply(&app, false);
}
```

Note: `State` is already imported at the top of `commands.rs` (`use tauri::State;`). Add `use tauri::AppHandle;` alongside it (or merge into one `use tauri::{AppHandle, State};` line) — don't add a conflicting second `use tauri::State`.

- [ ] **Step 2: Register the commands**

In `glint/src-tauri/src/lib.rs`, find the `use crate::settings::commands::{…}` import (it currently brings in `settings_get_all, settings_set`) and add the four new names. Then in the `tauri::generate_handler![…]` list, add:

```rust
            settings_set_hotkey,
            settings_reset_hotkeys,
            hotkeys_suspend,
            hotkeys_resume,
```

(If `settings_*` commands are referenced by full path in the handler rather than imported, match that existing style instead.)

- [ ] **Step 3: Build + run the Rust suite**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: builds; all tests pass (Task 1's `hotkeys::` tests + existing). The command bodies aren't unit-tested (they need a live `AppHandle` for registration) — they're covered at-screen in Task 6.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/settings/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p15): settings_set_hotkey/reset + suspend/resume commands"
```

---

### Task 5: Frontend — rebinding panel, store wiring, instructions

**Files:**
- Modify: `glint/src/lib/ipc.ts` (four IPC wrappers)
- Modify: `glint/src/store/useAppStore.ts` (`setHotkey`, `resetHotkeys`)
- Rewrite: `glint/src/views/settings/Hotkeys.tsx`
- Modify: `glint/src/views/settings.css` (capture/instruction/error styles)

**Interfaces:**
- Consumes: `keyEventToAccelerator`, `toChips` (Task 2); commands `settings_set_hotkey`, `settings_reset_hotkeys`, `hotkeys_suspend`, `hotkeys_resume` (Task 4); existing `persistSetting`, `Settings` type, `Section`/`Card` UI, `useAppStore`.

- [ ] **Step 1: Add IPC wrappers**

In `glint/src/lib/ipc.ts`, add near `saveSetting`:

```ts
/** Rebind one global shortcut. Rejects with a user-facing message on invalid/conflict. */
export async function setHotkey(action: string, accelerator: string): Promise<Settings> {
  return invoke<Settings>("settings_set_hotkey", { action, accelerator });
}

/** Restore all global shortcuts to their defaults. */
export async function resetHotkeys(): Promise<Settings> {
  return invoke<Settings>("settings_reset_hotkeys");
}

/** Disarm global shortcuts while the panel is capturing a key press. */
export async function suspendHotkeys(): Promise<void> {
  await invoke("hotkeys_suspend");
}

/** Re-arm global shortcuts after capture ends / on cancel. */
export async function resumeHotkeys(): Promise<void> {
  await invoke("hotkeys_resume");
}
```

- [ ] **Step 2: Add store actions**

In `glint/src/store/useAppStore.ts`:

(a) Add to the imports from `../lib/ipc` (the line `import { persistSetting, readSetting, saveSetting } from "../lib/ipc";`) the names `setHotkey as setHotkeyIpc, resetHotkeys as resetHotkeysIpc`:

```ts
import { persistSetting, readSetting, saveSetting, setHotkey as setHotkeyIpc, resetHotkeys as resetHotkeysIpc } from "../lib/ipc";
```

(b) Add to the `AppState` interface (near the other setters):

```ts
  setHotkey: (action: string, accelerator: string) => Promise<void>;
  resetHotkeys: () => Promise<void>;
```

(c) Add the implementations (near `setRecordFx`):

```ts
  setHotkey: async (action: string, accelerator: string) => {
    // Throws (rejected invoke) on invalid/conflict — the panel catches + shows it.
    const updated = await setHotkeyIpc(action, accelerator);
    await persistSetting("hotkeys", updated.hotkeys);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },

  resetHotkeys: async () => {
    const updated = await resetHotkeysIpc();
    await persistSetting("hotkeys", updated.hotkeys);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 3: Rewrite `Hotkeys.tsx`**

Replace `glint/src/views/settings/Hotkeys.tsx` with:

```tsx
import { useEffect, useRef, useState } from "react";
import { Section, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { keyEventToAccelerator, toChips } from "../../lib/hotkeys";
import { suspendHotkeys, resumeHotkeys } from "../../lib/ipc";

/** Human-readable labels (must match action_label() in Rust). */
const HOTKEY_LABELS: Record<string, string> = {
  capture_area: "Capture area",
  capture_window: "Capture window",
  capture_fullscreen: "Capture fullscreen",
  record: "Record",
  copy_path: "Copy path",
};

const HOTKEY_ORDER = ["capture_area", "capture_window", "capture_fullscreen", "record", "copy_path"];

/** Defaults (must match Hotkeys::default() in Rust) — drives the per-row Reset affordance. */
const DEFAULTS: Record<string, string> = {
  capture_area: "CmdOrCtrl+Shift+1",
  capture_window: "CmdOrCtrl+Shift+2",
  capture_fullscreen: "CmdOrCtrl+Shift+3",
  record: "CmdOrCtrl+Shift+5",
  copy_path: "CmdOrCtrl+Shift+C",
};

function sameAccel(a: string, b: string): boolean {
  const norm = (s: string) => toChips(s).map((c) => c.toUpperCase()).sort().join("+");
  return norm(a) === norm(b);
}

export function Hotkeys() {
  const settings = useAppStore((s) => s.settings);
  const setHotkey = useAppStore((s) => s.setHotkey);
  const resetHotkeys = useAppStore((s) => s.resetHotkeys);

  const [capturing, setCapturing] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<Record<string, string>>({});
  const flashTimer = useRef<number | null>(null);

  // While a row is capturing, listen for the next key combo. Esc cancels; Backspace/Delete
  // clears. Global shortcuts are suspended for the duration (see startCapture).
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        void endCapture();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        void commit(capturing, ""); // clear/disable
        return;
      }
      const accel = keyEventToAccelerator(e);
      if (accel) void commit(capturing, accel);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  async function startCapture(action: string) {
    setErrors((e) => ({ ...e, [action]: "" }));
    await suspendHotkeys().catch(() => {});
    setCapturing(action);
  }

  async function endCapture() {
    await resumeHotkeys().catch(() => {});
    setCapturing(null);
  }

  function doFlash(action: string, msg: string) {
    setFlash((f) => ({ ...f, [action]: msg }));
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash({}), 1600);
  }

  async function commit(action: string, accel: string) {
    try {
      await setHotkey(action, accel);
      doFlash(action, accel === "" ? "Cleared" : "Updated");
      setErrors((e) => ({ ...e, [action]: "" }));
    } catch (err) {
      setErrors((e) => ({ ...e, [action]: String(err) }));
    } finally {
      await resumeHotkeys().catch(() => {}); // re-arm on every path (validation errors don't)
      setCapturing(null);
    }
  }

  if (!settings) return null;

  return (
    <Section
      title="Keyboard shortcuts"
      description="Global shortcuts that work anywhere in Windows."
    >
      <Card>
        <div className="settings-hotkey-help" role="note">
          <strong>How to change a shortcut</strong>
          <ol>
            <li>Click <em>Change</em> on a shortcut, then press the key combination you want.</li>
            <li>Every shortcut needs <kbd className="settings-kbd">Ctrl</kbd>, <kbd className="settings-kbd">Alt</kbd>, or <kbd className="settings-kbd">Win</kbd> plus one more key (Shift is optional).</li>
            <li>Press <kbd className="settings-kbd">Esc</kbd> to cancel, or <kbd className="settings-kbd">Backspace</kbd> to clear a shortcut.</li>
          </ol>
          <p>Changes apply instantly. If a shortcut is already used by another app, Glint keeps your previous one and tells you.</p>
        </div>

        <ul className="settings-hotkeys-list" role="list">
          {HOTKEY_ORDER.map((key) => {
            const raw = settings.hotkeys[key] ?? "";
            const isCapturing = capturing === key;
            const err = errors[key];
            const flashed = flash[key];
            const isDefault = sameAccel(raw, DEFAULTS[key]);
            return (
              <li key={key} className={`settings-hotkey-row${isCapturing ? " is-capturing" : ""}`}>
                <span className="settings-hotkey-label">{HOTKEY_LABELS[key] ?? key}</span>

                <span className="settings-hotkey-keys" aria-label={raw || "not set"}>
                  {isCapturing ? (
                    <span className="settings-hotkey-listening">Press keys… <em>Esc to cancel</em></span>
                  ) : raw === "" ? (
                    <span className="settings-hotkey-empty">Not set</span>
                  ) : (
                    toChips(raw).map((chip, i) => (
                      <kbd key={i} className="settings-kbd">{chip}</kbd>
                    ))
                  )}
                </span>

                <span className="settings-hotkey-actions">
                  {flashed && <span className="settings-hotkey-flash">{flashed}</span>}
                  {!isCapturing && (
                    <button type="button" className="settings-hotkey-btn" onClick={() => void startCapture(key)}>
                      Change
                    </button>
                  )}
                  {!isCapturing && !isDefault && (
                    <button
                      type="button"
                      className="settings-hotkey-btn settings-hotkey-btn--ghost"
                      onClick={() => void commit(key, DEFAULTS[key])}
                    >
                      Reset
                    </button>
                  )}
                  {isCapturing && (
                    <button type="button" className="settings-hotkey-btn settings-hotkey-btn--ghost" onClick={() => void endCapture()}>
                      Cancel
                    </button>
                  )}
                </span>

                {err && <span className="settings-hotkey-error" role="alert">{err}</span>}
              </li>
            );
          })}
        </ul>

        <div className="settings-hotkey-footer">
          <button
            type="button"
            className="settings-hotkey-btn settings-hotkey-btn--ghost"
            onClick={() => void resetHotkeys()}
          >
            Reset all to defaults
          </button>
        </div>
      </Card>
    </Section>
  );
}
```

- [ ] **Step 4: Add panel styles**

Append to `glint/src/views/settings.css`:

```css
/* ── Rebindable hotkeys ─────────────────────────────────────────────────────── */
.settings-hotkey-help {
  margin-bottom: 14px;
  padding: 12px 14px;
  border-radius: 8px;
  background: rgba(120, 140, 255, 0.08);
  font-size: 12.5px;
  line-height: 1.5;
}
.settings-hotkey-help strong { display: block; margin-bottom: 6px; }
.settings-hotkey-help ol { margin: 0 0 6px; padding-left: 18px; }
.settings-hotkey-help p { margin: 0; opacity: 0.8; }

.settings-hotkey-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 0; }
.settings-hotkey-row.is-capturing { outline: 2px solid var(--accent, #5b7cfa); outline-offset: 4px; border-radius: 6px; }
.settings-hotkey-label { flex: 0 0 150px; }
.settings-hotkey-keys { flex: 1 1 auto; display: inline-flex; align-items: center; gap: 4px; }
.settings-hotkey-listening { opacity: 0.75; font-style: italic; }
.settings-hotkey-listening em { opacity: 0.6; font-size: 11px; }
.settings-hotkey-empty { opacity: 0.5; }
.settings-hotkey-actions { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.settings-hotkey-flash { font-size: 11.5px; color: var(--accent, #5b7cfa); }
.settings-hotkey-btn {
  padding: 3px 12px; border-radius: 6px; border: 1px solid rgba(128,128,128,0.35);
  background: transparent; color: inherit; font-size: 12px; cursor: pointer;
}
.settings-hotkey-btn:hover { background: rgba(128,128,128,0.14); }
.settings-hotkey-btn--ghost { border-color: transparent; opacity: 0.75; }
.settings-hotkey-error { flex-basis: 100%; color: #e5534b; font-size: 11.5px; }
.settings-hotkey-footer { margin-top: 12px; }
```

- [ ] **Step 5: Typecheck + frontend tests**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: `tsc` clean; all Vitest suites pass (incl. `lib/hotkeys.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/ipc.ts glint/src/store/useAppStore.ts glint/src/views/settings/Hotkeys.tsx glint/src/views/settings.css
git commit -m "feat(p15): rebindable hotkeys panel — capture UI, instructions, reset/clear"
```

---

### Task 6: Green gate, at-screen acceptance & merge

**Files:** none (verification + merge).

- [ ] **Step 1: Frontend gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: clean; all suites pass.

- [ ] **Step 2: Backend gate**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: builds; all Rust tests pass (incl. `hotkeys::`).

- [ ] **Step 3: Recorder/OCR isolation greps**

Run:
```bash
cd glint/src-tauri
grep -rnE "use +crate::(capture|editor|overlay|ocr)" src/recorder/ && echo VIOLATION || echo "recorder isolation OK"
grep -rnE "use +crate::recorder" src/ocr/ && echo VIOLATION || echo "ocr isolation OK"
```
Expected: both print "… OK".

- [ ] **Step 4: At-screen acceptance (with the user)**

Launch `npm run tauri dev`. In Settings → Keyboard shortcuts, verify:
1. The **instructions block** reads clearly at the top.
2. **Change** a shortcut (e.g. Capture area → `Ctrl+Shift+7`): the row shows "Press keys…", the new combo sticks, an "Updated" flash appears, and the new combo triggers a capture while the old one no longer does.
3. **No-modifier** press (e.g. just `A`) → inline "Add Ctrl, Alt, or Win to the shortcut."; binding unchanged.
4. **Duplicate** (set Record to Capture window's combo) → inline "Already used by Capture window."; unchanged.
5. **OS conflict** (bind to a combo Windows reserves, e.g. `Ctrl+Alt+Delete` won't even reach us — instead try one a background app owns) → "in use by another app.", previous binding stays live.
6. **Backspace** while capturing clears the shortcut ("Not set"); the action no longer fires; **Reset** restores it.
7. **Reset all to defaults** restores all five.
8. Rebinds **survive an app restart** (persisted).
9. While capturing, pressing a shortcut combo does **not** fire its action over the Settings window (suspend works).

- [ ] **Step 5: Merge to master**

After the user confirms:
```bash
cd "C:/Users/sanir/Claude Code/glint"
git checkout master
git merge --no-ff phase-15-rebindable-hotkeys -m "merge: Phase 15 — Rebindable Hotkeys (capture UI, validation, live re-registration)"
git branch -d phase-15-rebindable-hotkeys
```

---

## Notes for the implementer

- **Run `npx`/`cargo`/`git` from the directory in each command.** Repo root is `C:\Users\sanir\Claude Code`; frontend in `glint/`, Rust in `glint/src-tauri/`.
- **Dev-server exe lock:** if `cargo build` can't write `glint.exe`, run `Stop-Process -Name glint -Force` first.
- **Never touch** `glint/src-tauri/src/recorder/` or `glint/src/recorder/`.
- **Deadlock avoidance:** `settings_set_hotkey` must drop the `SettingsState` lock before calling `shortcuts::reapply` (which re-locks it). The plan's code already scopes the lock in a block.
- **Labels/defaults are mirrored** in Rust (`action_label`, `Hotkeys::default`) and TS (`HOTKEY_LABELS`, `DEFAULTS`). If you change one, change both.
- Global-shortcut register/unregister run synchronously on the calling thread — no webview build — so they're safe from a command handler (unlike overlay/HUD window builds).
