# Phase 8 — Screen Recorder (R3: Webcam overlay) — Design

**Status:** Designed; awaiting plan.
**Branch:** `phase-8-recorder-r3` (merges to `master`).
**Builds on:** R1 (core video, gdigrab+ffmpeg) and R2 (audio + post-recording HUD).

## Constraints (in force, unchanged)
- **Local-only:** everything stays on device — no cloud, no upload, no accounts, no
  network calls. The camera is a local device accessed via the browser media API.
- **Single-user:** no login/auth.
- **SACRED recorder isolation:** `glint/src-tauri/src/recorder/*.rs` imports nothing
  from `capture/`, `editor/`, or `overlay/`. R3 preserves this — see Isolation.

## Goal
Add a **live, draggable webcam bubble** to recordings (CleanShot/Loom style): a circular
camera feed the user can position anywhere and frame themselves with while recording, that
appears in the final video.

## Key insight / approach
The bubble is **just an on-screen window**, and gdigrab already records the whole screen —
**so the bubble is captured for free.** The recorder's video pipeline (gdigrab → ffmpeg)
is **completely untouched**: no camera enters ffmpeg, no `dshow` input, no `overlay`
filter, no second process opens the camera.

- A recorder-owned window (`rec-cam`) renders the live camera via the browser
  `getUserMedia({ video: true, audio: false })`. Local device only; no network.
- The window is borderless, transparent, always-on-top, and **NOT** excluded from capture
  (the opposite of the control bar) — so gdigrab BitBlt-captures the circular video wherever
  it sits, with the desktop showing through the transparent area around the circle.
- Video-only: audio stays entirely on the R2 WASAPI path (no webcam mic, no conflict).

This is simpler and more isolated than the roadmap's original "ffmpeg overlay filter" guess,
which is superseded by this design.

## Components

### 1. `rec-cam` window (recorder-owned)
- Builder `build_cam_bubble(app, target)` + `close_cam_bubble(app)` in
  `recorder/windows.rs` (mirrors `build_control_bar`). Borderless, `transparent(true)`,
  `always_on_top(true)`, `skip_taskbar(true)`, `resizable(false)`, focus-less, **not**
  capture-excluded. Sized to the chosen bubble diameter + padding for ring/shadow.
- Initial position: **bottom-right of the recording area** (region rect, or primary monitor
  for fullscreen) so it's inside the captured region by default; user drags from there.
- Label `rec-cam` is covered by the existing `rec-*` capability. getUserMedia requires the
  WebView2 media permission to be granted (see Risks/Spike).

### 2. `RecCam.tsx` (frontend, recorder-owned, route `#/rec-cam`)
- On mount: `getUserMedia({ video: true, audio: false })` → render the stream in a
  `<video autoplay muted playsinline>` clipped to a circle (`border-radius: 50%`),
  **un-mirrored** (no CSS flip). Subtle ring + shadow.
- **Drag:** press-and-drag the bubble calls `getCurrentWindow().startDragging()` (same as
  PinApp) to move the window.
- **Hover controls** (hidden at rest, shown on hover like the HUD toolbar): a size toggle
  (cycles S→M→L) and a close ✕ (turns the webcam off → recorder hides/closes the window).
  Hidden at rest so they're not in the recorded frame.
- Sizes: Small / Medium / Large diameters (≈120 / 170 / 230 px logical), default Medium.
  Changing size calls a command to resize the window (keeping it anchored to its corner).
- On camera error / permission denied: emit a toast (`glint-toast`) and self-close; the
  recording proceeds without the bubble.
- Added to the transparent-route list in `main.tsx` and the router (chrome-free route,
  outside AppShell), like the other recorder windows.

### 3. Enable + live toggle
- **Per-recording chip:** a "Webcam" chip in the region selector toolbar (next to the
  System/Mic audio chips), seeded from the new setting. Passed into `recorder_start` like the
  audio bools.
- **Settings:** new persisted bool `record_webcam` (default **false**) in
  `settings/mod.rs` (TDD: defaults + `apply_update`), `useAppStore`, and a Settings →
  Recording toggle. Mirrors the R2 audio settings exactly.
- **Live control-bar toggle:** a webcam button on the control bar opens/closes the `rec-cam`
  window mid-recording. Because the bubble is independent of ffmpeg, this is instant — no
  segment restart (unlike audio).

### 4. Recorder lifecycle hook
- `recorder_start`: if webcam enabled, open `rec-cam` at the countdown (so the user frames
  during 3-2-1); it persists through the recording.
- `recorder_stop` / `recorder_cancel`: `close_cam_bubble(app)`.
- The bubble is **not** part of the segment/ffmpeg machinery — it's a sibling window the
  recorder shows/hides. No change to `spawn_segment`, the ffmpeg args, pause/resume, or
  concat.

## Data flow
`record_webcam` setting → selector Webcam chip → `recorder_start(..., webcam: bool)` →
(if on) `build_cam_bubble` opens `#/rec-cam` → `RecCam` calls `getUserMedia` → circular
video on screen → **gdigrab captures it as part of the screen** → it's in the MP4. Control
bar webcam toggle → open/close `rec-cam`. Stop/cancel → close `rec-cam`.

## Isolation
- The new window builder + lifecycle hooks live in `recorder/` and use only Tauri + the
  recorder's own state; **no `capture::`/`editor::`/`overlay::` imports** (verify with grep).
- The frontend `RecCam` lives in `src/recorder/` and uses only the browser media API + Tauri
  window APIs (`startDragging`, a resize command). It does not touch capture/editor UI.
- The recorder's video/audio pipelines are unchanged; the only new outbound effect is a
  sibling on-screen window. The R1/R2 "MP4 + one Library row + HUD" coupling is unchanged.

## Error handling
- **No camera / permission denied:** `getUserMedia` rejects → toast + self-close; recording
  continues (silent video-wise, i.e. no bubble). The Webcam chip having been on shouldn't
  block the recording.
- **Region recording, bubble outside region:** default position is inside the region; if the
  user drags it out, it simply won't be captured (WYSIWYG — acceptable, matches the model).
- **Window build failure:** logged + toast; recording proceeds without the bubble.

## Testing
- **Unit (Rust, TDD):** `record_webcam` settings (defaults false; `apply_update` sets it),
  and the bottom-right default-position math for region vs fullscreen.
- **Spike (first):** prove a Tauri window can `getUserMedia` the default camera and render it
  (the de-risk gate — see Risks).
- **At-screen acceptance:** webcam on → circular bubble appears bottom-right during countdown,
  drags freely, sizes S/M/L, is present in the saved MP4 (un-mirrored); live toggle on/off
  mid-recording; no-camera path toasts and records without the bubble; region recording
  captures the bubble when inside the region; isolation grep clean.

## Risks
- **getUserMedia in WebView2 (primary):** Tauri must approve the WebView2 camera permission
  request (and possibly a capability/manifest entry). This is the R3 equivalent of R2's
  WASAPI unknown. **Mitigation: spike it first** — a minimal window that opens the camera and
  renders it — before building the full feature. If WebView2 won't grant camera access
  cleanly, rethink the approach before investing.
- **gdigrab capturing an always-on-top transparent window:** expected to work (BitBlt
  captures all visible windows; confirmed by the control bar needing explicit exclusion to
  stay *out* of the video). Verified at-screen.

## Out of scope / deferred
- **No camera device picker** (uses the default camera) — consistent with R2's deferred audio
  device pickers.
- **No rectangular bubble** — circle only (the signature look); a rectangle toggle can come
  later.
- **No mirror toggle** — un-mirrored, since on-screen == recorded (decoupling needs the
  heavier ffmpeg-composite approach, out of scope).
- **No background blur / effects.**
