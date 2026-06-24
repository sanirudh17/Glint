# Phase 6 — "Open in Glint" — Acceptance

**Status:** Built on `phase-6-open-in-glint`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-24-glint-phase6-open-in-glint-design.md
**Plan:** plans/2026-06-24-glint-phase6-open-in-glint.md

## Automated (green gate) — PASSED
- [x] `cargo build` OK; `cargo test` green — **47 passed, 0 failed, 2 ignored** (incl. `shell_integration` register/is_registered/unregister round-trip on a throwaway subkey; `settings` explorer_menu default + apply_update; `editor::commands` `first_image_arg` 4 cases).
- [x] `tsc --noEmit` clean; `vitest run` green — **41 passed**; `vite build` clean.

## At-screen (manual)
- [ ] First launch with the toggle ON auto-adds the entry: right-click a PNG/JPG in Explorer → **Open in Glint** appears.
- [ ] Click it while Glint is **CLOSED** (cold start) → editor opens with the image as an Untitled doc.
- [ ] Click it while Glint is **RUNNING** (warm start) → existing window comes forward into the editor; no second instance.
- [ ] Annotate + crop + frame → **Export** writes a PNG to the Library; **Save** writes a new `.glint`. The original file on disk is **unchanged**.
- [ ] Settings → General → toggle **OFF** → entry disappears from the right-click menu (toast confirms); toggle **ON** → it returns.
- [ ] Right-click a non-image / feed a bad path → friendly toast, no crash.
- [ ] Move/rename `glint.exe`, relaunch → entry self-heals to the new path.
- [ ] **Regression (window hijack):** take a capture so the HUD is showing → **Open in Glint** on an image → the HUD stays a HUD (does NOT turn into a mini-annotator); then press Ctrl+Shift+1 → the **selection overlay** appears (NOT a stuck fullscreen annotator), capture completes normally.

> **Note (Win11 placement):** the entry lives under Explorer's **"Show more options"** (Shift+F10), not the top-level menu. Top-level placement on Windows 11 requires a packaged build (MSIX/sparse package) with an `IExplorerCommand` COM handler — a future task for when Glint ships a real installer.

## Notes carried from review (for at-screen attention)
- **T1 (registry) — reviewer subagent (sonnet): Approved, spec compliant, 0 Critical/Important.** Minor notes deferred to the final whole-branch review:
  1. `current_exe_string` uses `to_string_lossy` — self-consistent (both register and is_registered go through it), so detection never oscillates; only cosmetic risk on a non-UTF-8 install path (vanishingly unlikely on Windows).
  2. `register_at` creates the `command` subkey from the HKCU root rather than the already-open key handle — stylistic, no behavioral difference.
  3. No `#[cfg(windows)]` guard on the module/tests — Windows-only app, low risk.
- **T3/T4/T5 reviewed inline** by the controller (lean cadence — diffs matched the plan verbatim).

## Decisions / out of scope (this phase)
- Right-click hook only (no "set as default image app" / no association takeover).
- Toggle defaults ON; HKCU-only (no admin); self-heals each launch; removal is the toggle's job.
- Non-destructive: external images open as Untitled; Save = new `.glint`, Export = new PNG; the source is never overwritten ("Save over original" intentionally out of scope).
- No formal registry-uninstaller (toggle-OFF is the supported removal; HKCU keys are per-user, harmless if left).
