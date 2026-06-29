# Phase 8 — Screen Recorder (R2: Audio) — Acceptance

**Status:** Built on `phase-8-recorder-r2`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-29-glint-phase8-recorder-r2-audio-design.md
**Plan:** plans/2026-06-29-glint-phase8-recorder-r2-audio.md

R2 adds **system audio + microphone** to the recorder. Both sources are
install-free via **WASAPI** (system = default render device opened in loopback;
mic = default capture device), streamed as f32le PCM over **Windows named pipes**
into the existing per-segment ffmpeg, which **mixes** (`amix`) and encodes **AAC**
(192k) alongside the gdigrab video. Pause/resume and concat are unchanged — each
segment carries its own audio, and live mute writes silence so streams stay
continuous and A/V-synced.

## Prerequisite — bundled ffmpeg sidecar (required at runtime)
Unchanged from R1. The bundled, **git-ignored** static `ffmpeg.exe` must be at
`glint/src-tauri/binaries/ffmpeg-<target-triple>.exe` (here
`ffmpeg-x86_64-pc-windows-msvc.exe`). The build was validated with the same ffmpeg
8.x build as R1. The ffmpeg must include the AAC encoder and `amix`/`aresample`
filters (any standard build does).

## Automated (green gate)
- [x] `cargo build` clean; `cargo test --lib` green — **66 passed / 0 failed /
  2 ignored**. New units: ffmpeg audio-args (`audio_inputs_carry_thread_queue_size`,
  `one_source_maps_directly_no_amix`, `two_sources_use_amix`,
  `no_audio_is_identical_to_silent_video`), `pipes::pipe_path_shape`, and settings
  (`defaults_audio_system_on_mic_off`, `apply_update_sets_audio_bools`).
- [x] `tsc --noEmit` clean; `vitest run` green (**46 passed**); `vite build` clean
  (pre-existing chunk-size warning only).

## At-screen (manual)
Play audio (music/video) during these so the capture has signal.

- [ ] **Spike sanity (optional):** `npm run tauri dev`, play sound, invoke
  `recorder_audio_check` → returns a peak **> 1000** (confirms WASAPI loopback +
  AUTOCONVERTPCM negotiate on this machine's default render endpoint).
- [ ] **System-only** (default chips: System on, Mic off) → record a few seconds of
  audio playing → Stop → the MP4 **has system audio** and plays in sync.
- [ ] **Mic-only** (selector: toggle System off, Mic on) → speak → MP4 has **only
  your voice**, no system audio.
- [ ] **Both** (System on, Mic on) → play audio + speak → MP4 has **both mixed** at
  comparable levels (amix), no clipping/echo.
- [ ] **Live-mute system** mid-recording (control-bar speaker toggle) → that span is
  silent on system audio but **keeps mic** (if on); unmute → returns. No A/V drift
  after the muted span (silence keeps the stream continuous).
- [ ] **Live-mute mic** mid-recording (control-bar mic toggle) → that span drops your
  voice but **keeps system audio**; unmute → returns.
- [ ] **Pause/resume with audio** → pause (timer + audio halt), resume, Stop → the
  concatenated MP4 has **continuous audio across the seam** with the paused gap
  excised (no audio from the paused interval).
- [ ] **60-second sync** → record ~60 s with system + mic → audio stays in sync with
  video end-to-end (validates `aresample=async=1` drift correction).
- [ ] **Absent/!available mic fallback** → with Mic enabled but no working capture
  device, starting still records (system/video) and a **"Microphone audio
  unavailable"** toast fires; no orphan bar/selector, no hang.
- [ ] **Settings ↔ chips** → Settings → Recording: toggle "Record microphone" on →
  the selector's Mic chip is **on by default** next time; toggling a chip in the
  selector affects **only that recording** (doesn't rewrite the setting).
- [ ] **Recorder isolation still holds:** `grep -rn "capture::\|editor::\|overlay::"
  glint/src-tauri/src/recorder` finds nothing; screenshots/editor/pins unaffected.

## Notes for the tester
- **Why WASAPI loopback (not a virtual device / dshow):** the single-user, no-install
  constraint. Loopback needs no admin, no driver, no Stereo Mix. System audio = the
  default **render** endpoint opened with `Direction::Capture` in shared mode (implicit
  loopback); mic = the default **capture** endpoint. A `WaveFormat` of f32le with
  `convert=true` (AUTOCONVERTPCM) guarantees the pipe bytes match ffmpeg's `-f f32le`.
- **Live mute = silence, not stream removal.** Muting writes equal-length zeroed
  buffers into the pipe so the AAC stream never gaps and A/V stays aligned. A source is
  only ever **opened if it was enabled at start** (privacy) — muting can't re-open it.
- **Bounded pipe accept (R2 hardening):** each pipe's `connect()` is wrapped in a **3 s
  timeout**. If ffmpeg never opens a pipe (bad args / dead sidecar), the capture thread
  is stopped, a "<source> audio unavailable" toast fires, and recording proceeds with
  whatever connected — no silent unbounded hang and no unbounded channel growth.
- **COM/thread-safety:** all WASAPI objects are `!Send`, so each source's capture runs
  on its own dedicated std thread; only the captured format and the f32le byte buffers
  cross the thread boundary (std mpsc + tokio unbounded channel).

## Deferred (accepted gaps)
- **No device pickers** — system uses the default render endpoint, mic the default
  capture endpoint. Choosing a specific device is out of scope for R2.
- **No per-source volume/gain sliders** — only on/off (selection) and mute (live).
  amix uses equal weights.
- **No level meters** in the control bar.
- **R3** = webcam overlay remains deferred; the isolated `recorder/` module is
  designed to slot it in without rework.
