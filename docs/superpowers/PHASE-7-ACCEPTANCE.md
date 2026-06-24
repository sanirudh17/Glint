# Phase 7 — "Pin to Screen" — Acceptance

**Status:** Built on `phase-7-pin-to-screen`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-24-glint-phase7-pin-to-screen-design.md
**Plan:** plans/2026-06-24-glint-phase7-pin-to-screen.md

## Automated (green gate)
- [x] `cargo build` OK; `cargo test` green — 52 passed / 2 ignored (incl. pin: next_label, insert/get/remove, forget, capped_size ×2).
- [x] `tsc --noEmit` clean; `vitest run` green (41 passed); `vite build` clean.

## At-screen (manual)
- [ ] Capture → HUD → **Pin** → a floating always-on-top image appears.
- [ ] Library → a capture's **Pin to screen** button → it pins.
- [ ] Drag the image to move it; it stays on top of other apps.
- [ ] Mouse-wheel over the pin scales it (aspect locked); corner handles resize it; both clamp (can't go below ~80px or past the screen).
- [ ] Right-click → Opacity 100/75/50/25 fades the image; → Copy (paste elsewhere); → Save to Library (appears in Library/Recent Captures); → Close.
- [ ] Hover **×** closes; **Esc** closes (after clicking the pin).
- [ ] Multiple pins at once, each independent; quitting Glint clears them all.

## Notes for the tester
- **Library affordance is a hover button only** (no per-card right-click menu) — matches the
  existing card pattern; the spec mentioned right-click but no card has a context menu today.
- **Corner-handle resize grows from the window's top-left origin** (the window is not
  re-anchored to the opposite corner during a left/top-handle drag). Functional; a cosmetic
  refinement for a future pass if desired.
- **Esc / keyboard close** requires the pin to have focus first (click it once) — the window
  is created focus-less so it never steals focus on creation.
