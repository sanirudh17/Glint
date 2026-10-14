# Studio Phase 2 — zoom, masks and motion blur

Plan: `docs/BUILD_PLAN.md`, tasks 2.1–2.6. Phase 1 accepted by the user on
2026-10-14 and checkpointed on `phase-1-studio-core`. Implementation branch:
`phase-2-studio-zoom-masks`. Existing main history remains intact.

## Verified paths and implementation choices

- `TrimView.tsx` owns the source-time playhead, persisted Studio project and export.
- `TrimTimeline.tsx` already has a source-time viewport and timeline magnification.
  Effect tracks use the same clock, so cuts, speed and reorder keep effects attached.
- `StudioPreview.tsx` draws the source through crop and framing on a Canvas.
- `studio_render.rs` caches the frame plate and pipes bounded RGB frames through
  FFmpeg; dynamic effects decode source pixels before scaling.
- `studio.rs` persists versioned projects and pause-aware event timestamps.
- `fx/hooks.rs` is the Studio cursor/click/key event source and can add local markers.
- FFmpeg/FFprobe and the local OCR runtime are already available as sidecars.

Project version 2 reads version 1 without discarding look, crop, cursor, clips or
camera settings. Effect coordinates and time ranges refer to the original source.
No new libraries, cloud services or bundled media are needed.

## Task checkpoints

- 2.1: zoom segment model, easing, source-clamped focus, follow cursor, split,
  inspector and draggable timeline track; preview and native export.
- 2.2: deterministic click clustering, isolated-click rejection, bounded spans,
  minimum gaps, travel-away exit and regeneration preserving all hand edits.
- 2.3: Ctrl+Alt+Z records a pause-aware Studio zoom marker, once per press.
  Import into the editor is idempotent; deleted marker zooms stay deleted.
- 2.4: pending.
- 2.5: pending.
- 2.6: pending.

## Final acceptance

- [ ] Auto-zoom generation is sensible; manual and edited generated zooms survive regeneration.
- [ ] A source-coordinate API-key mask stays attached through zoom; extracted export
  frames have no readable key in local OCR.
- [ ] A real export with at least 20 zooms and five masks completes without errors.
- [ ] Privacy note explains that projects retain the unmasked source; deletion or baking is available.
- [ ] Version 1 projects reopen and all Phase 2 edits survive save/reopen.

Loupe zoom is explicitly optional in the plan; the required whole-frame zoom is
implemented first. It is not part of the Phase 2 acceptance gate.
