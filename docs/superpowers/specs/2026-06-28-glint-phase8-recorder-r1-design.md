# Phase 8 — Screen Recorder (R1: Core Video) — Design Spec

**Status:** Approved (brainstorm) — awaiting spec review.
**Date:** 2026-06-28
**Branch:** `phase-8-recorder-r1` (off `master`)

## Goal

Record the screen (a dragged **region** or the **fullscreen** primary monitor) to a
silent **MP4**, with a CleanShot-style floating control bar, and have the finished
recording land in the Library as a `kind="recording"` row. This is **R1** — the
foundational video pipeline. Audio (R2) and webcam overlay (R3) are deferred but the
architecture here is designed so they slot in without rework.

## Binding constraints (unchanged, project-wide)

- **Local-first:** everything stays on device. No cloud, no upload, no accounts, no
  network calls. Single user, no auth.
- **Recorder isolation (SACRED):** the screenshot/library/editor path has **zero**
  dependency on the recorder. `scap` and `ffmpeg` live **only** inside the new
  `recorder/` module. `capture/`, `editor/`, and the Library list/grid import nothing
  from `recorder/`. The only coupling is *outbound from the recorder*: on stop it writes
  an MP4 + inserts one Library row — the same minimal seam screenshots already use.
- **Out of scope:** GIF capture/export, audio (R2), webcam (R3), window-target recording,
  scrolling capture, multi-monitor selection, pause/resume, in-app video player, recording
  settings UI (frame rate/quality pickers). All fixed defaults in R1.

## Overall recorder architecture (R1 → R2 → R3)

```
recorder/                      (NEW, isolated module — owns scap + ffmpeg sidecar)
  ├─ mod.rs        RecorderState, ActiveRecording, start/stop orchestration
  ├─ capture.rs    scap frame source (region/fullscreen) on a recorder thread
  ├─ encoder.rs    ffmpeg sidecar: spawn, pipe raw frames to stdin, finalize MP4
  ├─ pipeline.rs   wires capture → encoder; owns the recorder thread + stop signal
  ├─ thumb.rs      first-frame → PNG thumbnail (uses the shared `image` crate)
  └─ commands.rs   recorder_start / recorder_stop / recorder_status / recorder_cancel

Shared seam (outbound only): on stop, recorder inserts a db::NewCapture
{ kind:"recording", path:<mp4>, thumb_path, width, height, bytes, created_at }
and emits "capture-saved" — exactly like a screenshot commit. Nothing in the
screenshot path calls into recorder/.
```

**How R2/R3 extend this without rework:**
- **R2 (audio):** `capture.rs` gains sibling WASAPI capturers (system loopback + mic);
  `encoder.rs` adds extra ffmpeg inputs (`-i`) and maps audio tracks. The control bar
  gains mute toggles. `ActiveRecording` gains audio handles. No change to the shared seam.
- **R3 (webcam):** a camera frame source composited via ffmpeg's `overlay` filter; the
  control bar gains a webcam toggle/position. Still one MP4 out, one Library row.

The pipeline is a **deep module**: callers (commands, control bar) only see
`start/stop/status/cancel`; the scap↔ffmpeg plumbing is hidden behind `pipeline.rs`.

## R1 user flow

1. **Start.** Three entry points, all already stubbed: the tray "Start Recording" item,
   the `record` global hotkey, and a Home/Library button. The entry asks for **mode**:
   Region or Fullscreen. (Tray gets "Record Region" / "Record Fullscreen" submenu items;
   the hotkey defaults to Region.)
2. **Frame it.**
   - **Fullscreen:** no selection — uses the primary monitor's full bounds.
   - **Region:** a **live** (non-frozen) full-screen selector window dims the screen; you
     drag a rectangle (live content shows through so you can frame moving content), then
     confirm (release / Enter) or cancel (Esc). It hands the logical rect to the recorder.
     *Distinct from the screenshot overlay, which freezes a frame; recording must show live
     content, and a separate selector keeps recorder isolation clean.*
3. **Countdown.** A brief centered **3 · 2 · 1** countdown (a small always-on-top
   countdown window), so the user can get ready. Then it disappears and recording begins.
4. **Record.** `scap` grabs frames of the chosen region/monitor at **30 fps**; frames pipe
   to the bundled **ffmpeg** sidecar, which encodes **H.264 / yuv420p** straight to the MP4
   at native resolution. The **control bar** (a small always-on-top, focus-less but
   clickable window, bottom-center) shows a red **REC** dot, an **elapsed timer**, and a
   **Stop** button. (Audio/webcam toggles will live here in R2/R3.)
5. **Stop.** Via the control bar Stop button or the tray "Stop Recording" item. The
   pipeline signals the recorder thread to stop, closes ffmpeg's stdin so it finalizes a
   valid MP4, tears down the control bar, extracts a **first-frame thumbnail**, inserts the
   Library row, emits `capture-saved`, and shows a confirmation toast.
6. **Library.** The recording appears in the Library grid (and the "Recordings" filter that
   already exists) with its thumbnail and a ▶ play affordance. Clicking **opens it in the
   OS default video player** (Windows file association via the existing open path).
   Recording cards show video-appropriate actions only — **Open · Reveal · Delete** — not
   Copy/Edit/Pin (those are image-only). An in-app player is explicitly deferred.

## Tech stack & process model

- **Frame capture:** `scap` (Windows Graphics Capture under the hood). Captures the
  selected region (via scap's crop/area option) or the full monitor, yielding BGRA frames.
- **Encode/mux:** **ffmpeg**, bundled as a Tauri **sidecar** binary (`externalBin` in
  `tauri.conf.json`; resolved via the shell/process sidecar API). The recorder thread pipes
  raw frames to ffmpeg's **stdin**:
  `ffmpeg -f rawvideo -pix_fmt bgra -s <W>x<H> -r 30 -i - -c:v libx264 -pix_fmt yuv420p -movflags +faststart <out>.mp4`
  Closing stdin makes ffmpeg write the moov atom and exit cleanly.
- **State:** `RecorderState(Mutex<Option<ActiveRecording>>)`. `ActiveRecording` holds the
  ffmpeg child handle, a stop flag/`JoinHandle` for the recorder thread, the region/size,
  the start `Instant`, and the output path. Only one recording at a time (R1).
- **Threading:** the capture+pipe loop runs on a dedicated recorder thread (never the main
  thread). Windows are built off the main thread (per the new-window checklist).
- **Commands:** `recorder_start{ mode, rect? }`, `recorder_stop`, `recorder_status` (for
  the control bar to poll/confirm), `recorder_cancel` (discard, no Library row).

## New windows & capabilities (new-window checklist applies)

| Window | Label | Route | Notes |
|---|---|---|---|
| Region selector | `rec-select` | `#/rec-select` | Transparent, live (non-frozen), always-on-top, takes focus (needs key/mouse). |
| Countdown | `rec-countdown` | `#/rec-countdown` | Small, centered, always-on-top, focus-less, click-through. |
| Control bar | `rec-bar` | `#/rec-bar` | Bottom-center, always-on-top, focus-less but clickable (pin-window pattern). |

Each new window type requires: built off the main thread, a **label-scoped capability**
(`capabilities/recorder.json` covering `rec-*` with the window perms it needs:
start-dragging if movable, set-position/size, etc.), and a **forced recompile after editing
the capability** (cargo fingerprinting misses capability edits). All three share one
`capabilities/recorder.json` via the `rec-*` glob.

## Save location & format

- **Folder:** `Videos\Glint\` (separate from screenshots in `Pictures\Glint`).
- **Filename:** `Glint <YYYY-MM-DD at HH.MM.SS>.mp4` (mirrors the screenshot naming helper;
  reuse `paths::capture_filename` style with an `.mp4` extension + a recorder-local helper).
- **Format:** MP4, H.264 (libx264), yuv420p, 30 fps, native resolution, `+faststart`.
- **Thumbnail:** first captured frame → downscaled PNG in the existing thumbs dir
  (via the shared `image` crate; the recorder writes it directly — no call into `capture/`).

## Library integration (the only shared change)

- DB: recordings reuse the existing `captures` table with `kind="recording"`. No schema
  change (the column already exists; the "Recordings" filter already exists).
- `CaptureCard` branches on `item.kind`: for `"recording"` it shows a ▶ thumbnail overlay
  and the **Open / Reveal / Delete** actions only (no Copy/Edit/Pin/drag-image). Open uses
  the existing `capture_open` (OS default player via file association).
- This is the sole edit to shared UI; it lives in the Library views, which already own the
  "recording" concept. The recorder module is not imported here.

## Error handling

- **ffmpeg missing/launch failure:** abort cleanly, tear down windows, toast
  "Couldn't start the recorder" — never leave an orphaned control bar or selector.
- **scap/capture failure:** stop the pipeline, finalize whatever ffmpeg has (or discard if
  empty), toast a clear message.
- **Stop with zero frames / instant stop:** discard (no Library row), toast "Recording too
  short."
- **App quit while recording:** best-effort finalize on shutdown; never corrupt the MP4
  silently — at minimum close ffmpeg stdin.
- Every failure path gives visible feedback (toast) — never silent (project rule).

## Testing strategy

- **Pure/unit-testable (Rust):** ffmpeg arg-string construction, region→crop geometry,
  output path/filename building, elapsed-time formatting, the "too short → discard" decision.
  These are extracted as pure functions and unit-tested.
- **Not unit-testable (require a display/GPU/ffmpeg runtime):** scap capture, the sidecar
  pipe, window creation. Verified by `cargo build` + a manual **at-screen acceptance**
  checklist (record region + fullscreen, stop, file plays, Library row + thumbnail appear,
  cancel discards, error toasts fire).
- Frontend: `tsc` + `vitest` (no new logic-heavy units; the control bar timer formatting can
  get a small test).

## Open technical risks (to validate early in the plan)

1. **scap API shape & region cropping** on this Tauri/Windows version — confirm the crop/area
   option and BGRA frame format; fall back to ffmpeg `-vf crop` if scap can't crop.
2. **ffmpeg sidecar bundling** in Tauri v2 (`externalBin`, per-target binary naming, the
   process/shell permission to spawn it). Validate a trivial spawn first.
3. **Frame pipe throughput** — full-res BGRA at 30 fps is a lot of bytes; confirm scap→stdin
   keeps up (drop to region-only or a capped resolution if needed). Capturing the region
   (not full screen then cropping) keeps the pipe small.
4. **Clean finalization** — closing stdin must yield a playable MP4 (`+faststart`); verify the
   moov atom is written on normal stop and on app-quit.

## Deferred (explicitly not in R1)

- **R2:** system audio (WASAPI loopback) + microphone, each independently toggleable/mutable,
  muxed into the MP4. Control-bar audio toggles.
- **R3:** webcam overlay (composited bubble, position/size), recorded into the video.
- Also later: in-app player, frame-rate/quality settings, window-target recording,
  pause/resume, multi-monitor, countdown on/off preference.
