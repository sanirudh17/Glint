# Phase 5 — GIF export, scrolling capture and clean capture

Status: in progress, authorized by the user on October 20, 2026 after Phase 4.
Branch: `phase-5-capture-export`, based on `e3782ca`. Main remains unchanged.
Background removal and Phase 6 remain outside this work.

## Verified paths and plan

1. Repair the Phase 4 naming regression. `db/text_index.rs` previously named every
   indexed screenshot from the first OCR line and `settings/mod.rs` enabled this by
   default. Make naming opt-in and run a one-time repair limited to
   `title_origin='ocr'`, preserving manual names and the search index.
2. Fix dangling shared image paths. `capture/commands.rs` deletes temporary tray
   files on dismissal and eviction, while `lib/hudIpc.ts` hands those paths directly
   to the drag plugin. Preserve an image snapshot in a separate attachments folder
   before handing it to another app. Editor drag exports and tray Copy path must
   use the same durable storage. No agent-specific integration is needed.
3. Add GIF export to `recorder/TrimView.tsx`. Reuse
   `recorder/studio_export.rs` and `studio_render.rs` for Studio look, zoom and
   privacy, and the existing Quick trim graph for Quick edits. Use bundled FFmpeg
   palette generation/use; offer FPS, width and loop controls, progress and cancel.
   Publish only finished GIFs under a stated size cap; preserve all originals.
4. Add manual scrolling capture using `capture/frozen.rs`'s existing xcap backend
   and the existing region-selection overlay. A background worker collects settled
   frames; pure overlap logic detects displacement and repeated sticky bands,
   rejects ambiguous seams, and caps height/pixel allocation. Finish opens the
   stitched PNG in the existing editable screenshot editor. Auto-scroll is deferred
   as the build plan explicitly prioritizes manual mode.
5. Audit clean-capture controls and reuse what exists. Capture settings already
   have 3/5/10 second delays; window capture, path copying, file drag, and the
   latest-capture editor command already exist. Add only missing monitor choice,
   desktop-icon handling, Quick Access auto-close, media-file clipboard support,
   and a configurable latest-capture shortcut. Verify safe notification handling
   before offering an automatic system-setting change.

The UI keeps the established Taste-based app design. Use Impeccable for new
controls within existing panels, progress/error states and keyboard behavior.
No website redesign, model download or cloud dependency is part of this phase.

## Preliminary fixes

- `f429d4a`: OCR naming off by default; one-time title repair and preservation tests.
- `5edc929`: durable attachment paths; image snapshots survive source deletion.
- Native regression run: 240 passed, two pre-existing display tests ignored.
- Production/desktop validation: pending.

## Acceptance and measurement

- [ ] Generated OCR titles return to normal, manual names and search survive.
- [ ] Dragged image paths remain readable after dismissal, eviction and restart.
- [ ] Quick and Studio GIF exports apply edits/look, dimensions, FPS and loop.
- [ ] GIFs stay below the stated cap; cancellation leaves no published partial file.
- [ ] Long web-page and chat fixtures stitch without visible seams in manual mode.
- [ ] Sticky bands, no movement, overscroll, ambiguous matches and DPI are checked.
- [ ] Every new clean-capture option can be turned off and restores system state.
- [ ] Existing capture, editor, privacy and video behavior pass regression checks.
- [ ] Capture latency and idle/peak memory are measured against the pre-change app.

Before the new capture features, the installed native process used approximately
69 MB working set with Library open (WebView processes excluded; this is not a
whole-app memory claim). Record the complete process-tree baseline before final
comparison. Target no more than 20% idle-memory growth, keep expensive work off
the UI thread, and target warm region selection/metadata within 250 ms. Record
the actual measured results and explain any missed target before calling this
phase complete.
