# Phase 8 — Screen Recorder (R1: Core Video) — Acceptance

**Status:** Built on `phase-8-recorder-r1`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-28-glint-phase8-recorder-r1-design.md
**Plan:** plans/2026-06-28-glint-phase8-recorder-r1.md

## Prerequisite — bundled ffmpeg sidecar (required at runtime)
The recorder spawns a bundled **ffmpeg** sidecar. The binary is **git-ignored** (~97 MB,
`/binaries/ffmpeg-*`) and must be present per machine before building/running:

- Place a static `ffmpeg.exe` at `glint/src-tauri/binaries/ffmpeg-<target-triple>.exe`.
- On this machine the triple is `x86_64-pc-windows-msvc`, so:
  `glint/src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe`.
- Verify the triple with `rustc -Vv | grep host`. Tauri resolves the `externalBin`
  entry `binaries/ffmpeg` to `binaries/ffmpeg-<triple>.exe`.
- This build was validated with ffmpeg 8.1.1 (gyan.dev essentials build).

## Automated (green gate)
- [x] `cargo build` clean; `cargo test` green — **58 passed / 0 failed / 2 ignored**
  (the 2 ignored are display-only capture smoke tests). Recorder units: `even`,
  `build_ffmpeg_args` (fullscreen + region), `normalize_region`, `recording_filename`.
- [x] `tsc --noEmit` clean; `vitest run` green (**46 passed**, incl. 5 `mmss` formatter
  assertions); `vite build` clean (pre-existing chunk-size warning only).

## At-screen (manual)
- [ ] **Record Fullscreen** (tray → Record → Record Fullscreen) → 3·2·1 countdown →
  control bar appears bottom-center with a pulsing REC dot + ticking timer.
- [ ] **Stop** (control bar Stop button, or tray → Record → Stop Recording) → the bar
  disappears, a "Recording saved" toast fires, and an `.mp4` lands in `Videos\Glint\`
  and **plays** in the default video player.
- [ ] Library shows a **recording row** with a thumbnail + a ▶ play badge; the card
  exposes **Open · Reveal · Delete** only (no Copy/Edit/Pin, no image drag-out).
  **Open** launches the OS default player; **Reveal** opens Explorer; **Delete** removes it.
- [ ] **Record Region** (tray → Record Region, the `record` hotkey, or Home → Record) →
  live (non-frozen) selector dims the screen → drag a rectangle → countdown → records
  **just that region** → Stop → the MP4 is cropped to the selection.
- [ ] **Esc** cancels the region selector (no recording); a tiny drag also cancels.
- [ ] An almost-instant stop (sub-second) discards the file with a "Recording too short"
  toast (no Library row).
- [ ] **Longer recording** (record a few minutes, then Stop) → the MP4 is fully finalized
  and **seeks/plays to the end** (validates the `q`-then-wait-for-exit finalization, not
  a fixed-delay kill).
- [ ] **ffmpeg missing** (temporarily rename the sidecar) → starting a recording shows a
  "Couldn't start the recorder" toast and leaves **no orphan** control bar / selector.
- [ ] **Recorder isolation:** screenshots, the editor, and pins all still work;
  `grep -rn "recorder" glint/src-tauri/src/capture glint/src-tauri/src/editor` finds nothing,
  and `grep -rn "recorder" glint/src/views/library` finds nothing.

## Notes for the tester
- **Graceful stop:** the recorder sends `q\n` to ffmpeg's stdin and then **waits for
  ffmpeg to actually exit** (up to 30 s) so the MP4's `moov` atom is written
  (`+faststart`). It only force-kills as a last resort if ffmpeg is still alive 30 s
  after `q`. Killing mid-finalize would corrupt the file, so confirm long recordings
  play to the end. (Watch for: does `q\n` reliably stop ffmpeg on Windows piped stdin?
  Does the Tauri tokio runtime have its time driver enabled so the bounded wait /
  countdown sleep don't panic? — both are runtime checks this gate can't make.)
- **Fixed R1 defaults:** MP4 / H.264 (libx264, `-preset ultrafast`) / yuv420p / 30 fps /
  native resolution / `+faststart`. No audio, no webcam, no in-app player, no settings UI.
- **Region dims** are stored on the Library row; fullscreen dims are left unset (ffmpeg
  records at native resolution and the exact size isn't known at start).
- **Single-user assumption:** only one recording at a time; a second `recorder_start`
  while one is in flight is ignored. (A theoretical double-start race during the 3 s
  countdown is not guarded — out of scope for a single-user app.)
- **Deferred:** **R2** = system audio + microphone (independently mutable, `dshow`
  inputs); **R3** = webcam overlay. The architecture (ffmpeg-only capture+encode behind
  the isolated `recorder/` module) is designed so both slot in without rework.
