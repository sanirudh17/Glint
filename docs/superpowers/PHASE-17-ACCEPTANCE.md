# Phase 17 — P8 Capstone: Hardening, Cleanup & Docs — Acceptance

Close out the planned roadmap: the hardening/cleanup/tests/docs tail of the Phase 0
**P8 — "Polish"** capstone. **No new user-facing features.** The goal was a codebase that
builds and lints clean, a test suite that is honestly green, an audited-and-documented DPI
story, and a ROADMAP that records everything shipped through Phase 16.

This completes P8, delivered across **P15** (rebindable hotkeys), **P16** (settings
completeness), and **P17** (DPI/refresh hardening, cleanup, tests, docs).

## What this phase did (four buckets)

### 1. Dead-code & lint cleanup — `cargo build` + `cargo clippy` warning-clean

**Before:** `cargo build` 1 dead-code warning; `cargo clippy` 15 warnings.
**After:** both **0** (except consciously-retained, each-documented allows).

- Safe clippy autofixes applied and eyeballed: 3 redundant rebindings, 2 collapsible-`if`
  match guards, an unnecessary `u32`→`u32` cast, a no-effect `| 0`, a `match`→`if let`, and a
  `map_err`→`inspect_err` (the leftover `|e|` became `|_e|` — the closure only emits a fixed
  toast). Verified the `fx/hooks` match wildcard is a no-op, so the guard fall-through is
  behavior-identical.
- `recorder/trim.rs` empty-keep-region check rewritten from `!(e > s)` to
  `!matches!(e.partial_cmp(s), Some(Ordering::Greater))` — same behavior (still rejects NaN),
  explicit about the incomparable case.
- **Consciously retained, now documented** (were flagged, deliberately kept):
  - `recorder/audio.rs` `start_capture` return tuple — `#[allow(clippy::type_complexity)]`: the
    tuple *is* the fn's purpose (format + PCM receiver + thread handle), destructured immediately.
  - `recorder/{trim,mod}.rs` three Tauri-command / capture-constructor signatures —
    `#[allow(clippy::too_many_arguments)]`: arity is intrinsic (each arg is a distinct IPC field
    or capture parameter); a params struct would only add an indirection.

- **Dead code removed:** `LastCapture.saved` (written at both construction sites, never read —
  the Save↔Reveal toggle keys off `TrayItem.saved` + frontend state) and the orphaned
  `close_ocr_window` (no callers/tests; the OCR panel closes via its own window chrome).
- **Kept with a note:** `window_at` — documented as a reserved future hit-test *and* covered by
  two passing unit tests; the spec's "reserved code, keep the allow with a reason" case.

### 2. DPI audit (code-level) + refresh verification

**DPI — no bug found.** Every scale-sensitive path follows one correct pattern: read
`monitor.position()` as the origin (never hardcode (0,0)), scale logical dimensions by
`scale_factor()`, set `PhysicalPosition`/`PhysicalSize`.

| Path | File | Verdict |
|------|------|---------|
| Overlay fullscreen cover | `overlay.rs:52` | ✓ correct |
| HUD bottom-left placement | `hud.rs:56` | ✓ correct |
| HUD reposition on resize | `capture/commands.rs:509` | ✓ correct |
| Pin cascade placement | `pin.rs:91` | ✓ correct |
| Cursor composite origin | `capture/mod.rs:137` → `cursor.rs:78` | ✓ correct |
| Capture session scale | `capture/mod.rs:156` | ✓ correct |
| FX overlay cover | `recorder/fx/window.rs:28` | ✓ correct |

**Documented single-monitor limitation (deliberate, not a bug):** every path targets the
**primary** monitor. On a multi-monitor setup, capture always freezes the primary display and
the HUD/pin/overlay/fx windows always place on the primary — not the monitor under the cursor.
Supporting the active monitor would mean replacing `primary_monitor()` with cursor-hit monitor
selection across all these sites — out of scope for the single-monitor phase. (The user's setup
is single-monitor, so no cross-monitor behavior was verifiable at-screen regardless.)

**Refresh / live-state — all wired, no restart needed** (code-verified; interactively confirmed
at sign-off):

| Behavior | Mechanism |
|----------|-----------|
| Hotkey rebind | `settings_set_hotkey` → `shortcuts::reapply(strict)` + rollback on OS conflict |
| Show-in-taskbar | `window_set_taskbar` → `set_skip_taskbar` immediately |
| Sound-effects | read from live `SettingsState` at capture time |
| Save-folder | next capture resolves via `settings::locations` from live state |
| Capture → Library | `emit("capture-saved")`; Library listens + refetches |
| Delete → Library | `capture_delete` then `onChanged()` refetch |

### 3. Test sweep — honestly green

- **Baseline held:** 121 Rust tests (0 failed, 2 ignored) + 99 vitest (11 files) + `tsc` clean.
- The bare `#[ignore]` on `windows_enum::list_windows_does_not_panic` given a house-convention
  reason string (`"requires a real Windows desktop; run manually with --ignored"`), matching
  `frozen.rs`. The other ignore (`frozen.rs`, needs a real display) was already documented.
- Swept phases 12–16 for coverage gaps: editor model/composition/gradients, tray push+eviction,
  hotkeys (Rust + TS), locations `resolve`, and sound are **all already covered**. The remaining
  untested code is thin `invoke` IPC wrappers and pure data (`palette.ts`) — no tests added, to
  avoid coverage-theater.

### 4. Docs reconciliation

- `ROADMAP.md` brought up to truth: added shipped entries for **P12** (editor essentials + Done
  hand-off), **P13** (window-frame chrome), **P14** (quick-access overlay), **P15** (rebindable
  hotkeys), **P16** (settings gaps), plus this P17 entry, and marked the P8 capstone complete.
- This acceptance doc written.

## Final green gate

- `cargo build` — **0 warnings**.
- `cargo clippy` — **0 warnings** (except the documented, consciously-retained allows).
- `cargo test` — **121 passed, 0 failed, 2 ignored**.
- `npx vitest run` — **99 passed** (11 files).
- `npx tsc --noEmit` — **clean**.

## Isolation

No new cross-module coupling introduced. The recorder-isolation invariant holds: nothing under
`recorder/*` gained an import from `capture/`, `editor/`, `overlay/`, or `ocr/`; `ocr/` gained
nothing from `recorder/`. The one recorder-internal edit set (clippy allows, the `partial_cmp`
rewrite, the `inspect_err` binding) touches only recorder-owned code.
