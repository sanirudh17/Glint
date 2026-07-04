# Glint — Phase 21: Independent Webcam Layer (design)

*Date: 2026-07-04 · Base branch: `master` · Work branch: `phase-21-independent-webcam`*

## Goal

Let the webcam be **repositioned, resized, or removed after recording**, instead of being
locked into the video at capture time. Today the webcam is a live on-screen bubble that
`gdigrab` records *for free* as part of the screen — which is exactly why it is baked in and
cannot be moved later. This phase captures the camera as its **own video track** alongside a
clean screen recording, then composites it at export time at a position/size/shape the user
chooses in the trim editor.

This is an **opt-in mode**: today's proven baked-in bubble path stays the default and is
untouched. The user turns on independent capture per recording.

## Non-goals (v1)

- Shapes other than a **circle** (rounded-rectangle / square are future polish).
- Webcam placement in the clip **undo/redo** history — placement has its own Reset/✕/Add.
- A separate "recording composer" window — compositing lives in the existing trim editor.
- Multiple webcams / picture-in-picture of more than one camera.
- Changing the webcam's own trim independently of the screen (the cam always follows the
  screen edit: same cuts, same speed).

## Decisions (locked with the user)

1. **Opt-in mode**, not a replacement — the baked-in path is preserved.
2. **Free drag + resize handles** for placement (not corner presets).
3. **Pause/Resume is mirrored** to the webcam recorder so both stay in sync.
4. **Capture via `MediaRecorder`** in the existing `rec-cam` webview (Option A) — no `dshow`,
   single camera handle, best-effort + graceful fallback.
5. **Pre-start fallback:** if the movable webcam can't initialize *before* capture begins, fall
   back to today's baked-in bubble (un-exclude it) + a toast, so the user still gets *a* webcam.

## Architecture overview

```
Recording (independent mode ON)
  ┌ screen: gdigrab/ddagrab → libx264 → <name>.mp4   (bubble EXCLUDED from capture)
  └ camera: rec-cam webview MediaRecorder(vp8) ──chunks──▶ recorder_cam_write_chunk (append)
                                                            → <name>.cam.webm  (sibling)

Editing (trim editor)
  probe.has_cam == (<stem>.cam.webm exists)
  overlay <video src=cam.webm> as a draggable/resizable circle over the screen preview
  cam placement state = { x, y, diameter, visible }  (normalized 0..1 of the video frame)

Export (same trim ffmpeg pass, second input -i cam.webm)
  cam gets the IDENTICAL per-segment trim+setpts+concat as the screen (stays synced),
  then: scale→circular-alpha-mask→overlay(X,Y)→fades → [outv]
  cam absent OR visible=false  ⇒  overlay branch skipped ⇒ filter byte-identical to today
```

All new code stays inside the **isolated `recorder/`** module (`recorder/cam.rs` +
`RecCam.tsx` + `trim.rs`); nothing new is imported from capture/editor/overlay/ocr.

## Section 1 — Recording pipeline (capture side)

- **Enable:** when the **Webcam** chip is on, a secondary **"Movable (edit later)"** toggle
  appears on the recording selector, seeded from a new `record_webcam_movable` setting. Off →
  baked-in path (unchanged). On → independent mode.
- **At record start (independent mode):**
  - The `rec-cam` bubble window is marked **`WDA_EXCLUDEFROMCAPTURE`** (the same call the
    control bar already uses) so the screen video is captured clean. The user still sees the
    self-preview on screen.
  - `RecCam.tsx` attaches a `MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" })` to
    the camera stream it already holds. It is driven by events emitted **to `CAM_LABEL`**:
    - `rec-cam-record-start` — fired the instant screen capture begins (shared t=0).
    - `rec-cam-record-pause` / `rec-cam-record-resume` — mirrored from the control bar.
    - `rec-cam-record-stop` — stop, flush the final chunk, then signal done.
  - Each `ondataavailable` chunk → `blob.arrayBuffer()` → `invoke("recorder_cam_write_chunk",
    { bytes })`, a recorder-owned command that **appends** to the sidecar file (first chunk
    truncates/creates). Memory stays flat regardless of recording length. A `timeslice`
    (~1000 ms) guarantees periodic flushes.
  - On stop, Rust waits (bounded, ~3 s) for a `rec-cam-record-saved` signal before finalizing
    the recording, so the `.cam.webm` is complete on disk.
- **Isolation:** a small new `recorder/cam.rs` owns the sidecar path + write/append command and
  the cam recorder state; `RecCam.tsx` gains the `MediaRecorder` lifecycle. The screen
  ffmpeg/gdigrab/WASAPI path is unchanged except for the one exclude flag on the bubble.

## Section 2 — Storage & association

- The webcam track is a **sibling file**: `Videos\Glint\<name>.cam.webm` (derived from the
  screen `.mp4` stem). No new DB column.
- `recorder_trim_probe` gains **`has_cam: bool`** = "`<stem>.cam.webm` exists next to the
  recording." Works for Library recordings and externally-opened videos, and survives Library
  rename (which edits only the title, not the file).
- After export the original `.mp4` + `.cam.webm` remain intact, so the recording stays
  re-editable.

## Section 3 — Editor overlay UI

- When `has_cam`, `TrimView` loads `<stem>.cam.webm` into a second `<video>` and renders a
  **draggable, resizable circular overlay** over the screen-video preview.
- **Placement state** `cam = { x, y, diameter, visible }` is **normalized (0–1) to the video
  frame** — resolution-independent, maps directly to source pixels at export. A **pure,
  unit-tested helper** converts between screen px and normalized coords using the letterboxed
  (object-fit: contain) video rect inside the preview.
- **Interactions:** drag to move; drag a corner handle to resize (clamped min/max diameter);
  **✕** removes it (`visible=false`); **"Add webcam"** restores it at a default bottom-right
  spot; **Reset** returns to default position/size.
- **Playback sync:** the existing rAF playback loop also sets `camVideo.currentTime =
  mainVideo.currentTime` and matches `playbackRate`, so the overlay tracks scrubbing,
  per-segment speed, and gap-skips for free (slaved to the same time base).
- **Scope guard:** webcam placement is its **own React state**, deliberately kept out of the
  clip undo/redo stack for v1 (its own Reset/✕/Add cover correction). Keeps the change from
  tangling into trim history.

## Section 4 — Export filter

- The overlay bakes in during the **same** trim/export ffmpeg pass with a second input
  `-i cam.webm`. The cam track receives the **identical per-segment `trim`+`setpts`+`concat`**
  as the screen, so it stays frame-synced through cuts and speed changes:

  ```
  [1:v]trim=…,setpts=…[c0]; …                          (same segments as screen)
  [c0][c1]…concat=n=N[camcat];
  [camcat]scale=D:D,format=rgba,
          geq=…circular alpha…              → [cammask]
  [screencat][cammask]overlay=x=X:y=Y       → [ov]
  [ov]fade=in,fade=out                      → [outv]
  ```

  `X`, `Y`, `D` come from the normalized placement × source dimensions.
- **No cam, or `visible=false` ⇒ the overlay branch is skipped entirely ⇒ the filter is
  byte-identical to today's** — existing recordings and all current trim tests are unaffected.
- Audio is untouched (webcam is video-only; mic is already mixed into the screen mp4).
- The filter builder stays **pure + unit-tested**.

## Section 5 — Pause-mirror & error handling

- **Pause-mirror:** control-bar Pause/Resume emit `rec-cam-record-pause`/`-resume` to
  `CAM_LABEL`; `MediaRecorder.pause()/resume()` stop and start the WebM together with the
  screen segments — aligned by construction, no drift math.
- **Failure handling (each degrades safely):**
  - **Camera / `MediaRecorder` won't initialize *before* capture begins:** un-exclude the
    bubble and run today's **baked-in path** for that recording + toast *"Movable webcam
    unavailable — recorded in place."* The user still gets a webcam.
  - **A chunk write fails mid-recording:** toast once, stop the cam recorder, let the screen
    recording finish normally → a valid recording with no `.cam.webm` (no overlay offered).
    Never a broken recording.
  - **`cam.webm` missing / corrupt / too short at export:** skip the overlay branch, export
    screen-only, toast. The existing temp-file-first + rollback protects the original.

## Section 6 — Testing

- **Rust (pure, unit-tested):** extended trim-filter builder — no-cam byte-identical; cam +
  trim/speed/fades graph; circular-mask string; position/scale from normalized coords;
  `has_cam` sibling-path derivation; `cam_sidecar_path(<mp4>)` derivation.
- **Frontend (vitest, pure helpers):** normalized ↔ letterboxed-rect coordinate conversion;
  diameter clamping; default placement.
- **At-screen:** record in movable mode → verify a **clean screen video** (no baked bubble) +
  a `.cam.webm` sibling; in the editor drag/resize/remove the overlay; export and verify the
  circle lands where placed and stays synced through a **cut**, a **2× section**, and a
  **fade**; confirm Pause/Resume keeps sync; confirm the pre-start fallback toast when the
  camera is blocked.

## Green gate (unchanged)

From `glint/src-tauri`: `cargo clippy --all-targets` (0 warnings) + `cargo test`.
From `glint`: `npx tsc --noEmit` + `npx vitest run`.

## Rollout / sequencing note

The implementation plan will stage this as: (1) capture side — settings toggle, exclude flag,
`MediaRecorder` lifecycle, `recorder_cam_write_chunk`, sidecar; (2) `has_cam` probe; (3) editor
overlay UI + coordinate helpers; (4) export filter + builder tests; (5) pause-mirror +
fallbacks; (6) at-screen. Each step keeps the green gate passing (backend-first where possible).
