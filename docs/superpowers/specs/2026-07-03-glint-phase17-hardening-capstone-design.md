# Glint Phase 17 — P8 Capstone: Hardening, Cleanup & Docs — Design Spec

**Date:** 2026-07-03
**Status:** Approved (brainstorm). Awaiting plan.
**Builds on:** Phases 1–16 (capture, HUD, Library, editor, pin, recorder, trim, OCR,
recording-fx, editor-essentials, window-chrome, quick-access-overlay, rebindable-hotkeys,
settings-gaps), all on `master`.

## Goal

Close out the planned roadmap. This is the hardening/cleanup/docs tail of **P8 —
"Polish: settings completeness, hotkeys, DPI/refresh hardening, cleanup, tests, docs"**
(settings completeness shipped in P16, hotkeys in P15). **No new user-facing features.**
The aim is a codebase that builds and lints clean, a test suite that is honestly green, and
project docs that tell the truth about what shipped.

After this phase, everything remaining is explicitly *deferred* follow-up work (independent
webcam layer, recorder 60fps / device-picker, trim reordering / waveform).

## Baseline (measured 2026-07-03, before any work)

- **Rust:** `cargo build` — 1 dead-code warning (`saved` field never read). `cargo clippy` —
  15 warnings total (6 auto-fixable). `cargo test` — 121 passed, 0 failed, **2 ignored**.
- **Frontend:** `tsc --noEmit` clean (no unused/type errors). `vitest run` — 99 passed, 0
  failed, across 11 files.
- **Suppressed dead code:** 5 `#[allow(dead_code)]` sites (capture/mod.rs, capture/windows_enum.rs ×3, ocr/window.rs).
- **Ignored tests:** `capture/frozen.rs:121` (documented — needs a real display),
  `capture/windows_enum.rs:95` (bare `#[ignore]`, no reason).
- **TODO/FIXME/HACK markers:** 0.

The codebase is already in good shape; this phase is precise gap-closing, not firefighting.

## Scope

Re-weighted for the user's **single-monitor** setup: cross-monitor mixed-DPI behavior cannot
be reproduced or verified on the user's hardware, so DPI work is a **code-level audit and
honest documentation**, not an at-screen fix-and-verify effort.

### Bucket 1 — Dead-code & lint cleanup *(verifiable: warnings → 0, tests stay green)*

- Fix the live dead-code warning (`saved` field never read) — remove the field or wire it up,
  whichever the code shows is correct.
- Adjudicate all 5 `#[allow(dead_code)]` sites: delete what is genuinely dead; for code
  deliberately reserved (FFI-shaped structs, future hooks) keep the allow **and** add a
  one-line comment stating why it is retained, so it reads as intentional, not forgotten.
- Apply the 6 safe clippy autofixes (redundant rebindings of `png`/`path_str`/`cropped`,
  collapsible `if`, unnecessary `u32`→`u32` cast, no-effect operation). Verify each diff by
  eye; do not blind-apply.
- **Leave the 3 "too many arguments" warnings and the "very complex type" warning alone**
  unless a param-struct is a genuine readability win — these are usually intrinsic to command
  signatures, and churning them risks bugs for no user benefit. Any left in place is a
  conscious decision, noted in the acceptance doc.
- Exit criteria: `cargo build` warning-clean; `cargo clippy` clean except any consciously
  retained warnings, each documented.

### Bucket 2 — DPI / refresh audit *(DPI: code-level only · refresh: at-screen verifiable)*

- **DPI (audit + document):** read the scale-sensitive paths — capture crop origin, overlay /
  HUD / pin window positioning, cursor-composite origin (P16) — and write down, per path, how
  each handles the monitor scale factor and monitor origin. Fix anything *clearly* wrong (e.g.
  an unchecked assumption that the primary monitor sits at (0,0), or a mismatch between
  logical and physical coordinates). Known single-monitor-only assumptions are documented as
  honest limitations in the acceptance doc, not silently left.
- **Refresh (verify on the single monitor):** confirm live-state propagation with **no
  restart** — hotkey rebinds, taskbar toggle, sound toggle, and save-dir change all take
  effect immediately; the Library refreshes after a capture and after a delete; no stale UI
  state. Fix any gap found.

### Bucket 3 — Test sweep *(verifiable)*

- Baseline confirmed green (121 Rust + 99 vitest). Keep it green through all cleanup.
- Adjudicate the 2 ignored Rust tests: the display-dependent one stays ignored (reason already
  documented — leave as-is); the bare `#[ignore]` in `windows_enum.rs:95` gets either a real
  reason string or is un-ignored and made to pass.
- Add targeted unit tests **only** where phases 12–16 left a genuine logic gap. No
  coverage-theater — every added test must be able to fail for a real reason.

### Bucket 4 — Docs reconciliation *(verifiable by reading)*

- Update `ROADMAP.md`: it currently stops at Phase 11. Add the 5 shipped phases in the
  established "Shipped" prose style — **P12 editor-essentials, P13 window-chrome, P14
  quick-access-overlay, P15 rebindable-hotkeys, P16 settings-gaps** — each a concise
  what-shipped paragraph consistent with the existing entries. Mark **P8 complete**.
- Write `PHASE-17-ACCEPTANCE.md` covering the cleanup, the DPI audit notes (with documented
  single-monitor limitations), the refresh checklist, and the final green-gate numbers.

## Out of scope

- Any new user-facing feature.
- Multi-monitor / mixed-DPI at-screen verification (single monitor — cannot reproduce).
- The deferred follow-ups (webcam layer, 60fps `ddagrab`, webcam device picker, trim
  reordering / redo / waveform / fades).
- Large refactors — specifically the "too many arguments" / "very complex type" clippy
  warnings, unless a change is a trivial and obvious readability win.

## Verification / green gate

- `cargo build` warning-clean; `cargo clippy` clean except consciously-retained,
  each-documented warnings.
- `cargo test` and `vitest run` both green (≥ the 121 / 99 baseline, minus any test
  legitimately removed with a stated reason).
- `tsc --noEmit` clean.
- A single-monitor at-screen pass of the refresh checklist (settings live-apply, Library
  refresh after capture + delete).
- Read-through of the updated ROADMAP confirming phases 12–16 are recorded and P8 is complete.

## Isolation note

This phase touches cleanup across the tree but introduces no new cross-module coupling. The
recorder-isolation invariant is preserved: nothing under `recorder/*` gains an import from
`capture/`, `editor/`, `overlay/`, or `ocr/`, and `ocr/` gains nothing from `recorder/`.
