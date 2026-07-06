# Phase 25 — Developer Polish · Acceptance

**Date:** 2026-07-06
**Branch:** `phase-25-developer-polish` (off `master`)
**Spec:** `docs/superpowers/specs/2026-07-06-phase-25-developer-polish-design.md`
**Plan:** `docs/superpowers/plans/2026-07-06-phase-25-developer-polish.md`

## What shipped

Four developer-oriented features, plus two extensions folded in from the spec's
"deferred" list once they proved genuinely small.

1. **Redact tool** (editor) — a `redact` box annotation with a per-shape
   `Solid ⁄ Pixelate` toggle. Solid paints an opaque block (underlying pixels
   are gone from the export — true redaction); pixelate is a cached mosaic
   (`Konva.Filters.Pixelate`). Shortcut **K**. Bakes into the PNG via the
   existing stage flatten — no backend export change.
2. **Delayed capture** (self-timer) — three optional, unbound-by-default hotkey
   actions (`capture_area_delayed`, `capture_window_delayed`,
   `capture_fullscreen_delayed`) sharing one configurable duration
   (`capture_delay_secs`, 3/5/10, default 5). Shows an N-second countdown, then
   the normal capture. The countdown was promoted to a neutral `countdown.rs`
   module (recorder still uses it at N=3) so capture reuses it without breaking
   recorder isolation.
3. **Video resolution + quality presets** (recording) — `record_resolution`
   (Original/1080p/720p → aspect-preserving `scale` filter) and `record_quality`
   (High/Medium/Low → per-encoder quantizer flag via `quality_cq`: libx264
   `-crf`, NVENC `-cq`, QSV `-global_quality`, AMF `-qp`). Both captured once at
   session start and threaded through every segment to preserve the concat-copy
   invariant. High = the historical fixed quality, so it's a no-op default.
4. **Spotlight tool** (editor) — a `spotlight` box annotation that dims the whole
   canvas except one region (rect or ellipse), with an adjustable dim slider.
   Rendered as a cached dim layer with a `destination-out` cutout (isolated so it
   never punches through the base image). Shortcut **F**. Bakes into export.

**Deferred (next phase's base):** multi-region spotlight — documented clean path
(one annotation holding an array of regions → one dim layer, N cutouts).
**Dropped:** GIF export, scrolling capture.

## Green gate

- `cargo clippy --all-targets` — 0 warnings ✓
- `cargo test` — 180 passed, 2 ignored ✓
- `npx tsc --noEmit` — clean ✓
- `npx vitest run` — 129 passed ✓

New tests: redact/spotlight model duplicate+nudge; `capture_delay_secs` +
`record_resolution` + `record_quality` validation; `quality_cq` tiers;
`encoder_args` per-encoder quality flag; `scale_filter`; ddagrab/gdigrab scale
in the filter graph; original = no scale.

## At-screen acceptance checklist

Run `npm run tauri dev`:

- [ ] Redact **K** → solid black block hides content; **Pixel** toggle → mosaic; Save → solid shows no underlying pixels in the exported PNG.
- [ ] Spotlight **F** → dims all but the region; Rect/Ellipse toggle; dim slider; region draggable; export keeps the base image intact outside the hole.
- [ ] Bind `Delayed capture area` (e.g. `Ctrl+Shift+4`); trigger → countdown matches the Capture-delay setting → area overlay appears. Repeat window + fullscreen; confirm the countdown digit is NOT in a fullscreen shot.
- [ ] Record at Original/High and 720p/Low → the 720p/Low file is smaller and downscaled; playback valid.
- [ ] Regression: a normal recording still shows the 3·2·1 countdown; pause/resume still concatenates cleanly.

## Notes

- Editor tools are pure-frontend; both bake through the same flatten `blur` uses.
- Recorder isolation preserved: video presets live entirely in `recorder/`; the
  shared countdown is a neutral top-level module, not a recorder import.
- Serde `#[serde(default …)]` on the new fields keeps older persisted settings
  loadable; `hydrate_from_db` applies each new key on startup automatically.
