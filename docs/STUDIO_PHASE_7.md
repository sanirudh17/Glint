# Phase 7 — Studio polish

Completed on `phase-7-studio-polish`, following the numbered Studio plan in
`docs/BUILD_PLAN.md`. Phase 6 was checked before starting: its schema, transition
exports, acceptance evidence and four native scene tests remain valid. Phase 7
is the final numbered phase of this plan.

The user selected optional local captions and explicitly deferred multi-camera
and multi-display recording. Main and the installed app remain unchanged.
Validation uses the separate `com.glint.validation.phase5.capture` profile.

## Delivered scope

| Plan item | Implementation and behavior |
| --- | --- |
| Motion presets | Eight bounded zoom easing presets and eight title entrance choices including None. Old projects retain their existing motion. |
| Animated backgrounds | Optional 12–120 second gradient cycle in video Look controls. Preview and export blend two cached plates; still screenshots stay static. |
| Webcam layouts | Overlay with existing circle/rounded/rectangular shapes, Side by side and Camera only. Camera-only retains the Studio look and captions; layout modes preserve cuts and speed. |
| Typing and idle speed | Source-event analysis suggests 2× timing edits using the existing cut model. Stationary cursor samples do not count as activity. Imported videos without events do not invent activity. |
| Silent stretches | Local audio scan with a review step before removal. Keeps 150 ms around speech boundaries; limited to 30-minute recordings. Cuts retain audio synchronization. |
| Audio cleanup | Optional FFmpeg background-noise reduction and volume leveling on MP4 exports. Both are off by default. |
| Local captions | Explicit download, local English transcription, editable text/timestamps and optional burned-in captions. Removing a transcript line removes that source span; timing Undo restores it. |
| Speaker notes | Separate always-on-top local notes window. Windows capture exclusion is set and verified before the window becomes visible; failure closes it. |
| Recording controls | Reused countdown and pause/resume. Added confirmed restart of the same recording target and optional export click sounds retimed to cuts/speed. |
| Export conveniences | Approximate MP4 size range before export and Copy video file after export, including combined projects. |
| Editor crop | Reused the existing source crop controls and preview/export mapping. |
| Commands and undo | Ctrl+K in both recording and scene editors. Timing and scene undo/redo describe the action; command palette supports keyboard navigation and Escape. |
| Title cards | Entrance animation for title text and optional line, circle or rectangle decoration through the shared compositor. |

The source media is preserved. New fields are optional and preserve the existing
project versions. Captions and timing remain anchored to source time so reordered
and accelerated spans use the corresponding text and audio. Caption rasters are
prepared from the chosen font and validated before native encoding.

## Design

Taste's app-screen workflow was used, with a bounded Impeccable review. Existing
Manrope, theme tokens and accent colors remain. Studio now has Look / Edit /
Polish panels, readable single-line labels, a pinned preview, spaced sections
and a footer that wraps its actions together. Accent button text chooses the
more legible black or white foreground without changing the user's accent.

The isolated UI check covers dark 1400 × 850, dark 1100 × 720 and light 850 × 720,
all three panels, with no horizontal overflow or runtime errors. Taste inspects a
script-free snapshot of the real React DOM/styles, with an actual captured
preview image, because its separate browser cannot call native Tauri IPC.
The final inspection has no findings. Explicit allowances cover real media
colors, hidden video decoders without posters, compact timeline metadata and
independent editor panes rather than equal-height content cards. Impeccable
reports no findings on the changed controls and layouts.

## Optional caption download

Nothing downloads automatically. Choose Studio → Polish → Local captions →
Download caption engine, then Generate captions. English only; review names and
technical words. Source audio stays local. The inference process has no upload
step. Both installation and inference can be cancelled.

- CPU runtime: [whisper.cpp v1.8.2 x64 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.8.2), 3,832,432 bytes.
- Model: [Whisper tiny.en GGML](https://huggingface.co/ggerganov/whisper.cpp/blob/main/ggml-tiny.en.bin), 77,704,715 bytes.
- Combined download: approximately 77.8 MiB. Extraction also needs temporary disk space.
- Both artifacts are pinned by SHA-256 in `recorder/captions.rs`. Model and runtime
  live under the active profile's `captions-whisper-1.8.2` folder. They are not
  bundled into Glint or installed into the production profile by validation.
- Processing uses four CPU threads and supports recordings up to 30 minutes.
  Runtime depends on recording length and this machine's CPU; progress describes
  the operation rather than predicting a false completion percentage.

## Verification

- Frontend: 261 tests pass; TypeScript and the production frontend build pass.
- Native: 263 tests pass, two existing display-dependent tests remain ignored.
  Only the three pre-existing unused prewarm warnings remain.
- Real native fixtures verify reordered/speed-adjusted audio/video, caption
  pixels, animated title transitions, both new camera layouts, speech
  transcription and cancellation, silent-span detection and speaker-notes
  capture exclusion. A retimed click has 1600 Hz amplitude 0.0411 versus 0.00042
  away from the click. The timing fixture is 2.0 seconds; the title transition
  fixture is 2.4 seconds. The four-second audio fixture finds quiet time at
  1.15–2.85 seconds, retaining the intended speech padding.
- The shared Studio GIF path also exports a two-second, 320 px-wide fixture
  within the 25 MB cap, with no audio stream.
- UI fixtures separately verify opt-in installation, caption deletion/Undo,
  named scene Undo/Redo, Ctrl+K/Escape and responsive layouts. The Phase 6 layout
  and navigation regression also passes. Native IPC is stubbed only for these
  UI checks; actual media/export behavior is covered by the native fixtures.
- The open six-scene draft is preserved, and source media SHA-256 is unchanged.
  Temporary native scene workspaces are cleaned after export.

Run the native acceptance check from the repository root while the isolated
native dev app exposes CDP 9242:

```powershell
node scripts/studio-phase7-check.mjs --captions
node scripts/studio-phase7-ui-check.mjs
```

`--captions` explicitly authorizes downloading into the isolated validation
profile; omit it to skip model install/inference. Evidence and generated media
are under `%LOCALAPPDATA%\GlintValidation\Phase7`, with UI screenshots and reports
under its `UI` directory. No installer was built or installed.

## Quick user check

- Open a recording: Look → Background motion; preview and export a short MP4.
- Edit → Zoom: try the easing presets. With a webcam track, try all three layouts.
- Polish → Timing & audio: review silent spans, remove them, then Undo. Enable
  noise reduction/leveling and export to hear the result.
- Optionally download captions, generate and correct a line, remove its video
  span and Undo. Export to confirm the corrected text is burned into the MP4.
- Press Ctrl+K, search an action, then Escape. Open speaker notes for recording.
- In Video project, add a title card, choose an entrance/shape, play and export.

## Deferred

- Multi-camera tracks and simultaneous multi-display/window recording, as the
  user explicitly requested.
- Optional screenshot background removal remains deferred from Phase 3. No
  background-removal model or inference runtime was added by this phase.
- Captions currently target English and single recording projects. Multi-language
  models and a combined-scene transcript editor are future extensions.
