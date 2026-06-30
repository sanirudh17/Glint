# Phase 8 — Screen Recorder (R2: Audio + post-recording HUD) — Acceptance

**Status:** Built on `phase-8-recorder-r2`; merging to `master`. Mic-clarity at-screen
check deferred by the user (public environment) — see Deferred.
**Spec:** specs/2026-06-29-glint-phase8-recorder-r2-audio-design.md
**Plan:** plans/2026-06-29-glint-phase8-recorder-r2-audio.md

R2 adds **system audio + microphone** to the recorder, plus a **post-recording HUD**.
Both sources are install-free via **WASAPI** (system = default render device opened in
loopback; mic = default capture device), streamed as f32le PCM over **Windows named
pipes** into the per-segment ffmpeg, which **mixes** (`amix=…:normalize=0`), normalizes
every audio output to **48 kHz stereo AAC** (so segments concat-copy cleanly), and muxes
with the gdigrab video. Pause/resume/concat are unchanged — each segment carries its own
audio.

## Prerequisite — bundled ffmpeg sidecar (required at runtime)
Unchanged from R1. The bundled, **git-ignored** static `ffmpeg.exe` must be at
`glint/src-tauri/binaries/ffmpeg-<target-triple>.exe` (here
`ffmpeg-x86_64-pc-windows-msvc.exe`). Validated with ffmpeg **8.1.1** (gyan.dev). Must
include the AAC encoder + `amix`/`aresample`/`aformat`/`pan`/`equalizer`/`anullsrc`
filters (any standard build does).

## Automated (green gate)
- [x] `cargo build` clean; `cargo test --lib` green — **69 passed / 0 failed / 2 ignored**.
- [x] `tsc --noEmit` clean; `vitest run` green (**46 passed**); `vite build` clean
  (pre-existing chunk-size warning only).

## Behavior model (changed from the mid-build doc — read this)
- **Both sources open whenever the recording has any audio.** The one left OFF in the
  selector starts **muted** (its capture thread reads then zeroes the buffer → only
  silence is ever written). This is what lets the user **unmute either source live** from
  the control bar. Trade-off: opening the mic to allow live-unmute lights the OS mic
  indicator even on a system-only recording (no mic content is ever written).
- **Live mute = silence, not stream removal** — equal-length zeroed buffers keep the AAC
  stream continuous and A/V aligned.
- **A/V sync:** the pipe pump **drops the pre-roll backlog** captured while ffmpeg's
  gdigrab input was initializing, so audio lines up with the first video frame;
  `aresample=async=1` absorbs residual drift.
- **System loopback** is driven by **polling** (read every wake, not only on the WASAPI
  event) so it keeps flowing after a pause/resume re-open.
- **Control bar** appears immediately after the countdown (ffmpeg comes up behind it).
- **Recording at 60 fps** target (gdigrab actually delivers ~35–37 fps at 1080p — see
  Deferred for true 60).

## At-screen (manual)
- [ ] **System-only** (default chips) → record with audio playing → MP4 has system audio, in sync.
- [ ] **Mic-only** (toggle System off, Mic on) → speak → MP4 has only your voice.
- [ ] **Both** → play audio + speak → both mixed at full level (normalize=0), no clipping.
- [ ] **Live unmute a source that was OFF at start** → start system-only, then click the mic
  toggle mid-recording and speak → your voice comes in; click again → it cuts.
- [ ] **Live-mute** system / mic mid-recording → that span drops the muted source, keeps the
  other; no A/V drift after.
- [ ] **Pause/resume with audio** → continuous audio across the seam; **system audio survives
  the resume** (the poll-loopback fix); paused interval excised.
- [ ] **60-second sync** → audio stays in sync end-to-end.
- [ ] **Control bar** is centered, appears right after the countdown, shows both toggles.
- [ ] **Post-recording HUD** → after Stop, a bottom-left card appears with the video
  thumbnail; hover reveals Open / Reveal / Copy-path; the thumbnail drags the MP4 into
  another app; close dismisses; a new recording replaces it.
- [ ] **Library** → recording cards drag out the MP4 (no ghost preview) and have a Copy-path button.
- [ ] **Recorder isolation:** `grep -rn "capture::\|editor::\|overlay::" glint/src-tauri/src/recorder` finds nothing.

## Deferred (accepted gaps / follow-ups)
- **Mic clarity — at-screen unverified.** Mic negotiates 48 kHz stereo (not narrowband); a
  mic-only voice EQ (mono-collapse + de-rumble + de-box + presence) is applied. If it still
  reads hollow, the cause is Windows' mic APO (echo-cancel / noise-suppression) — the real
  fix is **RAW capture mode** (`AUDCLNT_STREAMOPTIONS_RAW`), which `wasapi 0.15` doesn't
  expose, so it needs a small direct-COM path. Tracked follow-up once the user confirms.
- **True 60 fps** — gdigrab caps ~35–37 fps at 1080p. Real 60 needs the **`ddagrab`
  (Desktop Duplication)** backend (available in the bundled ffmpeg 8.1.1) with a GPU
  device + `hwdownload`, kept behind a gdigrab fallback. Tracked follow-up (needs at-screen
  test on the user's GPU).
- **No device pickers / volume sliders / level meters.**
- **R3** = webcam overlay remains deferred; the isolated `recorder/` module slots it in.
