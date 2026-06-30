# Phase 8 — Screen Recorder (R3: Webcam overlay) — Acceptance

**Status:** Built on `phase-8-recorder-r3`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-30-glint-phase8-recorder-r3-webcam-design.md
**Plan:** plans/2026-06-30-glint-phase8-recorder-r3-webcam.md

R3 adds a **live webcam bubble** to recordings. The bubble is a recorder-owned on-screen
window (`rec-cam`) rendering the **default camera** via the browser `getUserMedia`
(video-only, local device, no network). Because it sits on screen and is **not** excluded
from capture, **gdigrab records it as part of the screen** — so the ffmpeg/gdigrab pipeline
is **completely untouched** (no `dshow`, no `overlay` filter, no arg changes).

## Prerequisite — camera access in WebView2
The bubble calls `navigator.mediaDevices.getUserMedia({ video: true, audio: false })` inside
the Tauri WebView2 window. The OS must allow desktop apps to use the camera
(Windows Settings → Privacy & security → Camera). If WebView2 denies the request, the
**Task 1 spike is the gate** — confirm the camera renders before relying on the feature
(see At-screen, first item).

## Automated (green gate)
- [x] `cargo build` clean; `cargo test --lib` green — **71 passed / 0 failed / 2 ignored**
  (new: `settings::defaults_webcam_off`, `apply_update_sets_webcam`).
- [x] `tsc --noEmit` clean; `vitest run` green (**46 passed**); `vite build` clean
  (pre-existing chunk-size advisory only).

## Architecture note (why ffmpeg is untouched)
The webcam is **not** composited by ffmpeg. The `rec-cam` window is a sibling on-screen
window; gdigrab's existing full-screen BitBlt captures it wherever it sits. R3 only adds a
recorder-owned window + an enable toggle. Consequence: the bubble's orientation in the live
preview and in the recording are identical (so it's **un-mirrored** — correct output over a
natural self-view), and for a **region** recording the bubble must be **inside the region**
to appear (it defaults to the region's bottom-right).

## At-screen (manual)
- [ ] **Spike / camera gate:** start a recording (or earlier: the spike) with webcam on →
  a **circular live camera** bubble appears. If it's black / permission-denied, fix camera
  access (Windows privacy; WebView2 permission) before trusting the rest.
- [ ] **Enable via chip:** Webcam chip on the selector defaults **off** (from `record_webcam`);
  toggle it on → record → the bubble appears **bottom-right of the recording area** during the
  3-2-1 countdown and is **in the saved MP4**, un-mirrored.
- [ ] **Drag:** press-drag the bubble → it moves; release → stays. For a region recording,
  dragging it outside the region removes it from the capture (WYSIWYG).
- [ ] **Sizes:** hover → resize control cycles **Small → Medium → Large**, staying anchored
  bottom-right; ✕ turns the webcam off (bubble closes).
- [ ] **Live toggle:** the control-bar webcam button turns the bubble **on/off mid-recording**
  — instant, even if the recording started with webcam off (it's independent of ffmpeg).
- [ ] **Hover controls stay out of the video:** at rest the bubble is a clean circle; the
  resize/✕ controls only appear on hover.
- [ ] **No camera / denied:** with webcam on but no camera (or permission denied) → a
  "Camera unavailable" toast, and the recording proceeds **without** the bubble (no hang).
- [ ] **Stop/cancel** closes the bubble. **Settings → Recording → Record webcam** persists the
  default and seeds the selector chip.
- [ ] **Recorder isolation:** `grep -rnE "crate::(capture|editor|overlay)" glint/src-tauri/src/recorder` finds nothing; `git diff` shows **no change** to `build_ffmpeg_args`/gdigrab args.

## Notes for the tester
- **Why on-screen-bubble (not ffmpeg overlay/`dshow`):** simplest + most flexible (live
  drag/frame), zero camera↔ffmpeg conflict, and it keeps the recorder pipeline + isolation
  intact. The roadmap's original "ffmpeg overlay" guess is superseded by this design.
- **Live-toggle edge:** if you toggle the webcam ON mid-recording and then *deny* the camera
  prompt, the backend still returns Ok (it can't observe the browser getUserMedia outcome); the
  bubble self-closes with a toast, but the control-bar toggle may still read "on" until clicked
  again. Cosmetic.

## Deferred (accepted gaps)
- **No camera device picker** (uses the default camera) — consistent with R2's deferred audio pickers.
- **No rectangular bubble** — circle only (the signature look); a rectangle toggle can come later.
- **No mirror toggle** — un-mirrored, since on-screen == recorded (decoupling needs the heavier
  ffmpeg-composite approach, out of scope).
- **No background blur / effects.**
