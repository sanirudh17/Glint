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
- 2.4: source-pixel blur/pixelate/solid masks, keyframed rectangles, drawing and
  resizing in preview, timeline trimming, duplicate/copy/split and whole-clip
  defaults. A privacy note and explicitly confirmed source-deletion option keep
  sharing limited to the finished export. Thumbnail names are unique per path.
- 2.5: keyframed highlights dim and optionally blur outside the chosen source
  rectangle. Privacy masks are applied first, so highlights cannot restore them.
- 2.6: optional, off-by-default light shutter blur for fast zoom/pan and cursor
  movement. Every transform sample uses the current masked source, preventing
  unmasked history from leaking when a privacy mask begins or moves.

## Final acceptance

- [x] Auto-zoom generation is sensible; manual and edited generated zooms survive regeneration.
- [x] A source-coordinate API-key mask stays attached through zoom; extracted export
  frames have no readable key in local OCR.
- [x] A real export with at least 20 zooms and five masks completes without errors.
- [x] Privacy note explains that projects retain the unmasked source; deletion or baking is available.
- [x] Version 1 projects reopen and all Phase 2 edits survive save/reopen.

## Verification evidence

Validated on 2026-10-14 in the actual rebuilt Tauri/WebView2 app. A separate
validation app identifier kept the installed app and its settings independent.

- 225 frontend tests passed. They cover zoom easing/splitting/focus limits,
  follow-cursor stabilization, automatic click groups and preservation of edited
  generated segments, marker import, mask keyframes and motion samples.
- 221 native tests passed; two existing desktop-capture tests remain ignored.
  Native checks include source-pixel redaction, transformed cursor positions,
  mask validation, highlighting and compatibility with version 1 projects.
- TypeScript and the full Tauri debug build passed. Existing unused prewarm and
  frontend bundle-size warnings remain.
- The real editor generated four auto-zoom groups from four click pairs. A manual
  segment survived regeneration unchanged. Drawing a mask mapped its rectangle
  to the expected source pixels within one pixel and defaulted to the entire
  12-second source.
- The synthetic source contained a readable fake API key. Blur, pixelate and
  solid exports each passed OCR at 0, 0.15, 0.5, 1 and 2.8 seconds through a 2×
  zoom. The blur case also enabled maximum motion blur. OCR still read the
  unmasked fixture heading at the start, while none of the frames revealed the
  key. This evidence applies to the tested mask strength and coverage.
- A 12-second, 640×360, 15 fps fixture with 22 zooms and five simultaneous masks
  produced a complete 754×424 MP4 with audio. The final checked run took 11.13 seconds,
  including export setup and probing. This is a stability check; the Phase 1
  1080p60 performance/audio evidence remains in `STUDIO_PHASE_1.md`.
- Saved zoom/mask arrays reopened unchanged. A version 1 project hydrated to
  version 2 while preserving its look and clips.
- Source deletion rejected an unrelated export and retained the source. With
  its own finished export present, a disposable test project deleted its source
  and input events while preserving the MP4. The UI option is off by default and
  asks for confirmation after successful export.
- Fixed external camera-track file access and paused masked-preview caching.
  The regression loads a camera track outside `Videos/Glint`, delays its readiness,
  and verifies that its frame appears without playing or seeking the source.
  A solid source mask also covered that camera in a real export.
- Inspected the zoom and mask controls in the native desktop viewport and at
  1280×800. They retain the accepted compact controls and themed components.
  Taste source lint passed with zero failures and zero warnings.

Reproducible local checks are in `scripts/studio-phase2-fixture.py`,
`scripts/studio-phase2-acceptance.mjs` and `scripts/studio-phase2-camera-check.mjs`.
The fixture generator prints its temporary root; pass that root to the two Node
scripts while the rebuilt editor is open with WebView2 debugging bound to
`127.0.0.1:9227`. Generated media, OCR results and screenshots remain outside Git.
The checked artifacts are in the OS temp folder `glint-phase2-tulyuzov`.

**Phase 2 acceptance is complete.** Tasks 2.1–2.6 have individual commits on
`phase-2-studio-zoom-masks`; the Phase 1 checkpoint remains on
`phase-1-studio-core`. Main has not been merged or rewritten.

Loupe zoom is explicitly optional in the plan; the required whole-frame zoom is
implemented first. It is not part of the Phase 2 acceptance gate.

## Follow-up: existing recordings open in Studio

The initial editor gate required a native Studio folder. An older standalone MP4
therefore opened only the basic trim editor, even in the newest build. Existing
videos now automatically prepare Studio edit metadata when opened through Trim
or the file-launch argument. Quick recording still saves an ordinary MP4.

For an imported video, a small `<filename>.glint-studio` folder beside it holds
`project.json`, empty input-event metadata and an `origin.json` reference. The
original video is read directly; it is neither copied nor overwritten. Reopening
the original reuses the saved zooms, masks, crop, look and cuts. Export creates a
separate `<stem> (Studio).mp4`. Native source deletion refuses imported originals,
and the UI hides that option for imports. Keep the project folder beside its video
to retain the edits.

Manual zoom, masking, highlights, motion blur, looks and crop work on imported
videos. They start with no added padding, rounding or shadow. Cursor editing,
follow-cursor focus and click-based automatic zoom require input data captured
during recording; their unavailable state is explained in the editor.

Verification: 226 frontend tests and 223 native tests passed (two existing capture
tests ignored), plus TypeScript and a full Tauri build. `scripts/studio-import-check.mjs`
opens a standalone fixture, adds zoom and a drawn source-coordinate mask through
the real editor, verifies save/reopen, exports through the native compositor and
checks OCR. It also confirms that imported-source deletion is rejected and the
original SHA-256 remains identical. Runtime evidence is in the OS temp folder
`glint-import-check-ho4np4`.

The reported `Glint 2026-07-02 at 12.26.46.mp4` was opened successfully with the
Studio panel, Zoom and Masks & focus. Its SHA-256 matched before and after import.
