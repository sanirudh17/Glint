# Phase 15 — Rebindable Hotkeys — Design

**Status:** design (awaiting approval → plan)
**Branch (to be):** `phase-15-rebindable-hotkeys` → merge to `master`

## Goal

Turn the read-only Hotkeys settings panel into a working rebinder for all five global
shortcuts. Replace the placeholder note *"Reconfiguring shortcuts is available in a later
phase."* with **click-to-capture** rebinding, inline validation, live OS re-registration,
per-row reset/clear, and **visible in-app instructions** so the procedure is discoverable.

This is the first of three small "polish capstone" phases decomposed from the original
Phase 0 build-order line *"P8 | Polish: settings completeness, hotkeys, …"*. The other two
(settings gaps; DPI/cleanup/docs) are separate later phases — out of scope here.

## Global constraints (unchanged)

- **Local-first / single-user:** no cloud, accounts, auth, or network. Shortcuts persist to
  the existing local SQLite `settings` table only.
- **Recorder isolation (SACRED):** this phase touches `settings/`, `shortcuts.rs`, and the
  settings UI. It does **not** import anything into `recorder/`, `ocr/`. The `record`
  shortcut's *handler* is untouched — only its accelerator string can change.
- **Tauri v2 IPC casing:** `invoke` arg keys are camelCase → snake_case Rust params. This
  phase's command args are single-word (`action`, `accelerator`) or a plain object, so no
  multi-word-key hazard.

## Current state (what already exists)

- `settings/mod.rs`: `Hotkeys { capture_area, capture_window, capture_fullscreen, record,
  copy_path }` as accelerator strings (defaults `CmdOrCtrl+Shift+1..3/5/C`); `apply_update`
  already accepts a whole-object `"hotkeys"` key; 20+ unit tests.
- `settings/commands.rs`: `settings_get_all`, `settings_set(key, value)` (mutates in-memory
  `SettingsState`).
- `settings/hydrate.rs`: `hydrate_from_db` reloads persisted rows at startup.
- Frontend `persistSetting(key, value)` writes JSON to the DB; `saveSetting`/`settings_set`
  update live Rust state. `useAppStore` mirrors settings + has a generic setter pattern.
- `shortcuts.rs::register(app)`: reads the five accelerators from `SettingsState`, registers
  each with `global_shortcut().on_shortcut(...)`, logging+skipping failures. Called once at
  startup.
- `views/settings/Hotkeys.tsx`: read-only list of rows (label + `<kbd>` chips), with the
  "later phase" note.

## Design

### A. Backend — validation, live re-registration, rollback

**A1. Pure accelerator validation** — new `settings/hotkeys.rs` (unit-tested, no Tauri types):

```rust
/// The five rebindable actions, in display order. Single source of truth shared by
/// validation, dedupe, reset, and re-registration.
pub const HOTKEY_ACTIONS: [&str; 5] =
    ["capture_area", "capture_window", "capture_fullscreen", "record", "copy_path"];

pub enum HotkeyError { Empty, NoModifier, BadKey, Duplicate(String /*action label*/) }

/// Validate one accelerator string in Tauri's format (e.g. "CmdOrCtrl+Shift+1").
/// Rules: non-empty; at least one of Ctrl/Alt/Super(Win) (Shift alone is NOT enough — a
/// bare or shift-only global key would hijack normal typing); exactly one non-modifier
/// key from a known set; tokens join with '+'.
pub fn validate_accelerator(accel: &str) -> Result<(), HotkeyError>;

/// True if `accel` equals any OTHER action's current binding (case-insensitive, modifier-
/// order-insensitive via a normalized form). Returns the conflicting action key.
pub fn duplicate_of(hotkeys: &Hotkeys, action: &str, accel: &str) -> Option<String>;
```

- "Modifier present" accepts `Ctrl`/`Control`/`CmdOrCtrl`/`CommandOrControl`/`Alt`/`Option`/
  `Super`/`Win`/`Meta`. `Shift` counts as a modifier token but does **not** by itself satisfy
  the "needs a real modifier" rule.
- Known non-modifier keys: `A–Z`, `0–9`, `F1–F24`, and a small punctuation/nav set
  (`,./;'[]\\-=` `` ` `` , arrows, `Space`, `Tab`, `Enter`, etc.) — matching what
  `tauri-plugin-global-shortcut` parses.
- Normalization for dedupe: uppercase + sort modifier tokens so `Ctrl+Shift+A` ==
  `Shift+Ctrl+A`, and `CmdOrCtrl` == `Ctrl`.

**A2. Re-registration** — extend `shortcuts.rs`:

```rust
/// Unregister every currently-registered global shortcut, then register from the current
/// settings. Used after a rebind. Returns Err if the NEW set fails to fully register.
pub fn reregister(app: &AppHandle) -> Result<(), String>;
```

Implementation: `global_shortcut().unregister_all()`, then call the existing `register(app)`
logic — but change `register` so a **hard** failure (the OS rejects an accelerator, e.g.
already owned by another app) is surfaced rather than only logged, so the command can roll
back. Startup keeps today's tolerant behavior (log + skip) via a `strict: bool` param or a
thin wrapper.

**A3. Command** — `settings/commands.rs`:

```rust
/// Rebind one action. Validates → dedupe-checks → writes in-memory → re-registers with the
/// OS → on any failure, rolls back the in-memory value and returns a user-facing message.
/// On success returns the updated Settings (frontend then persists "hotkeys" to the DB).
#[tauri::command]
pub fn settings_set_hotkey(app, state, action: String, accelerator: String)
    -> Result<Settings, String>;

/// Restore all five hotkeys to their defaults, re-register, return updated Settings.
#[tauri::command]
pub fn settings_reset_hotkeys(app, state) -> Result<Settings, String>;
```

- Empty `accelerator` = **clear/disable** that action (allowed; skipped during registration).
- Errors map to friendly text: `NoModifier` → "Add Ctrl, Alt, or Win to the shortcut.";
  `Duplicate(x)` → "Already used by {x}."; OS reject on reregister → "That shortcut is in use
  by another app." On the OS-reject path, the previous binding is restored **and** re-armed
  before returning, so the user never ends up with nothing registered.

**A4. Persistence:** unchanged mechanism. On a successful `settings_set_hotkey`, the frontend
calls `persistSetting("hotkeys", updated.hotkeys)` so the whole object survives restart
(`hydrate_from_db` + existing `"hotkeys"` case in `apply_update` already handle load). The
command itself does not touch the DB — it owns live state + registration only.

### B. Frontend — the rebinding panel

**B1. Pure key mapper** — new `lib/hotkeys.ts` (unit-tested, no React/Tauri):

```ts
/** Map a browser KeyboardEvent to a Tauri accelerator ("Ctrl+Shift+1"), or null if the
 *  event is only modifiers held (still waiting for the main key). Uses e.code for layout-
 *  stable letters/digits; normalizes to Tauri modifier tokens (Ctrl/Alt/Shift/Super). */
export function keyEventToAccelerator(e: KeyboardEvent): string | null;

/** Split an accelerator into display chips (reuses the existing parseHotkey logic). */
export function toChips(accel: string): string[];
```

**B2. Rewrite `Hotkeys.tsx`** to a capture-driven list:

- Each row: label · current chips · a **Change** button · a **Reset** button (shown when the
  binding differs from its default). A small **Clear** (×) disables the shortcut.
- **Capture mode:** clicking **Change** (or the chips) puts that row into listening state:
  chips are replaced by *"Press keys…"* and a hint *"Esc to cancel"*. A window `keydown`
  listener (added only while capturing, `preventDefault`) feeds `keyEventToAccelerator`; when
  it returns a full combo, we call `settings_set_hotkey`.
  - **Esc** cancels (no change). **Backspace/Delete** while capturing = clear/disable.
  - Only one row captures at a time.
- **Feedback (visible-feedback rule):** on success the chips update in place + a subtle
  "Updated" flash; on a validation/conflict error the row shakes briefly and shows the
  friendly message inline (`aria-live`), leaving the old binding intact.
- **Reset all** button in the section header → `settings_reset_hotkeys`.

**B3. In-app instructions (explicit user requirement):** a short, always-visible instruction
block at the top of the Hotkeys section — not a tooltip — stating the procedure and rules:

> **How to change a shortcut**
> 1. Click **Change** on a shortcut, then press the key combination you want.
> 2. Every shortcut needs **Ctrl, Alt, or Win** (plus optionally Shift) and one more key.
> 3. Press **Esc** to cancel, or **Backspace** to clear a shortcut.
> Shortcuts apply instantly and work anywhere in Windows. If one is already used by another
> app, Glint keeps your previous shortcut and tells you.

This text is the discoverable "correct procedure" surfaced in the app itself.

**B4. Store wiring:** `useAppStore` gains `setHotkey(action, accel)` and `resetHotkeys()`
that call the commands, update `settings.hotkeys` from the returned `Settings`, and
`persistSetting("hotkeys", …)` on success; errors propagate to the panel for inline display.

### C. Data flow (rebind, happy path)

```
user presses combo in a capturing row
  → keyEventToAccelerator(e) = "Ctrl+Shift+4"
  → invoke settings_set_hotkey({ action:"record", accelerator:"Ctrl+Shift+4" })
      Rust: validate_accelerator ok → duplicate_of none
            → write SettingsState.hotkeys.record
            → shortcuts::reregister(app): unregister_all + register(strict)
            → ok → return updated Settings
  → store: settings.hotkeys = updated.hotkeys; persistSetting("hotkeys", updated.hotkeys)
  → row chips update + "Updated" flash
```

Failure paths (`NoModifier`, `Duplicate`, OS reject) return `Err(msg)`; the store leaves
state untouched and the panel shows `msg` inline; the previously-registered shortcut stays
live (rolled back + re-armed in the OS-reject case).

## Error handling summary

| Situation | Where caught | Result |
|-----------|--------------|--------|
| Empty / modifiers-only press | mapper returns null | keep listening |
| No Ctrl/Alt/Win | `validate_accelerator` | inline "Add Ctrl, Alt, or Win." |
| Unknown/unsupported key | `validate_accelerator` | inline "Unsupported key." |
| Duplicate of another action | `duplicate_of` | inline "Already used by {action}." |
| OS rejects (owned by another app) | `reregister` strict | rollback + re-arm old; toast "in use by another app" |
| Startup: a persisted binding won't register | `register` tolerant | log + skip (today's behavior) |

## Testing

- **Rust unit tests** (`settings/hotkeys.rs`): modifier-required; shift-only rejected;
  known/unknown keys; dedupe normalization (order + `CmdOrCtrl`≡`Ctrl`); empty allowed
  (clear). Command-level: `settings_set_hotkey` updates the field; rejects duplicate; reset
  restores defaults. (Registration/OS paths aren't unit-testable headless — covered
  at-screen.)
- **Frontend unit tests** (`lib/hotkeys.test.ts`, Vitest): `keyEventToAccelerator` for
  letters/digits/F-keys, modifier combos, modifiers-only → null, Shift-only mapping,
  `e.code`-based layout stability; `toChips` formatting.
- **Green gate:** `tsc --noEmit`, `vitest run`, `cargo build`, `cargo test`, recorder/ocr
  isolation greps.
- **At-screen acceptance:** rebind each action; verify it fires on the new combo and no
  longer on the old; duplicate + no-modifier rejected with the right inline message; a known
  OS-owned combo (e.g. one Windows reserves) rolls back; Reset restores defaults; Clear
  disables; bindings survive an app restart; the instruction block reads correctly.

## Out of scope (this phase)

- New *actions* (e.g. a hotkey for OCR/pin) — only the existing five are rebindable.
- Chord/sequence shortcuts, per-window (non-global) shortcuts.
- Custom save-folder picker and other settings gaps → **Phase 16**.
- DPI/refresh hardening, dead-code cleanup, ROADMAP reconciliation → **Phase 17**.

## Files touched

- **New:** `glint/src-tauri/src/settings/hotkeys.rs` (validation core + `HOTKEY_ACTIONS`);
  `glint/src/lib/hotkeys.ts` (mapper) + `glint/src/lib/hotkeys.test.ts`.
- **Modify:** `settings/mod.rs` (declare `pub mod hotkeys;`), `settings/commands.rs`
  (`settings_set_hotkey`, `settings_reset_hotkeys`), `shortcuts.rs` (`reregister`,
  strict/tolerant `register`), `lib.rs` (register the two commands), `views/settings/
  Hotkeys.tsx` (rewrite), `store/useAppStore.ts` (`setHotkey`/`resetHotkeys`),
  `views/settings.css` (capture/instruction styles).
- **Docs:** this spec; ROADMAP note deferred to Phase 17's reconciliation.
