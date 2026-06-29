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
  dependency on the recorder. The bundled **ffmpeg** sidecar lives **only** behind the new
  `recorder/` module. `capture/`, `editor/`, and the Library list/grid import nothing
  from `recorder/`. The only coupling is *outbound from the recorder*: on stop it writes
  an MP4 + inserts one Library row — the same minimal seam screenshots already use.

- **Capture backend (decided during planning):** R1 is **ffmpeg-only** — ffmpeg captures the
  screen region/monitor directly (`ddagrab` Desktop-Duplication primary, `gdigrab` fallback)
  **and** encodes, in one process. No Rust capture loop, no frame piping. This removes the
  scap-API and pipe-throughput risks and extends cleanly to R2 audio (`dshow` audio inputs)
  and R3 webcam (`dshow` video input + `overlay` filter). A scap/WGC capture path can replace
  the ffmpeg capture input later without changing the rest of the architecture.
- **Out of scope:** GIF capture/export, audio (R2), webcam (R3), window-target recording,
  scrolling capture, multi-monitor selection, pause/resume, in-app video player, recording
  settings UI (frame rate/quality pickers). All fixed defaults in R1.

## Overall recorder architecture (R1 → R2 → R3)

```
recorder/                      (NEW, isolated module — owns the ffmpeg sidecar)
  ├─ mod.rs        RecorderState, ActiveRecording, start/stop orchestration
  ├─ ffmpeg.rs     build the ffmpeg arg list (ddagrab/gdigrab capture + libx264 mux),
  │                spawn the sidecar with a piped stdin, graceful-stop ("q"), wait
  ├─ thumb.rs      finished MP4 → first-frame PNG thumbnail (a quick ffmpeg extract)
  └─ commands.rs   recorder_start / recorder_stop / recorder_status / recorder_cancel

Shared seam (outbound only): on stop, recorder inserts a db::NewCapture
{ kind:"recording", path:<mp4>, thumb_path, width, height, bytes, created_at }
and emits "capture-saved" — exactly like a screenshot commit. Nothing in the
screenshot path calls into recorder/.
```

**How R2/R3 extend this without rework:**
- **R2 (audio):** `ffmpeg.rs` adds `-f dshow -i audio=...` inputs (system loopback + mic) and
  maps/mixes them into the MP4. The control bar gains mute toggles; `ActiveRecording` records
  which sources are active. No change to the shared seam.
- **R3 (webcam):** a `-f dshow -i video=<camera>` input composited via ffmpeg's `overlay`
  filter; the control bar gains a webcam toggle/position. Still one MP4 out, one Library row.

The recorder is a **deep module**: callers (commands, control bar) only see
`start/stop/status/cancel`; the ffmpeg argument-building and process lifecycle are hidden
behind `ffmpeg.rs`/`mod.rs`.

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
4. **Record.** The bundled **ffmpeg** sidecar captures the chosen region/monitor
   (`ddagrab`→`gdigrab`) at **30 fps** and encodes **H.264 / yuv420p** straight to the MP4 at
   native resolution, in one process. The **control bar** (a small always-on-top, focus-less
   but clickable window, bottom-center) shows a red **REC** dot, an **elapsed timer**, and a
   **Stop** button. (Audio/webcam toggles will live here in R2/R3.)
5. **Stop.** Via the control bar Stop button or the tray "Stop Recording" item. The recorder
   sends **`q`** to ffmpeg's stdin so it finalizes a valid MP4 (never kills it — that would
   corrupt the file), waits for exit, tears down the control bar, extracts a **first-frame
   thumbnail**, inserts the Library row, emits `capture-saved`, and shows a confirmation toast.
6. **Library.** The recording appears in the Library grid (and the "Recordings" filter that
   already exists) with its thumbnail and a ▶ play affordance. Clicking **opens it in the
   OS default video player** (Windows file association via the existing open path).
   Recording cards show video-appropriate actions only — **Open · Reveal · Delete** — not
   Copy/Edit/Pin (those are image-only). An in-app player is explicitly deferred.

## Tech stack & process model

- **Capture + encode (one process):** **ffmpeg**, bundled as a Tauri **sidecar** binary
  (`externalBin` in `tauri.conf.json`; spawned via the shell/process sidecar API). ffmpeg
  captures the screen directly and encodes to MP4. Region example (gdigrab):
  `ffmpeg -f gdigrab -framerate 30 -offset_x <X> -offset_y <Y> -video_size <W>x<H> -i desktop -c:v libx264 -pix_fmt yuv420p -movflags +faststart <out>.mp4`
  Fullscreen is the same minus the offset/size (`-i desktop`). `ddagrab` (hardware-accelerated
  Desktop Duplication) is preferred when available, with `gdigrab` as the reliable fallback.
  ffmpeg is spawned with a **piped stdin**; sending **`q`** makes it stop gracefully and write
  the moov atom (a clean, playable MP4). Killing the process is never used (it corrupts the file).
- **State:** `RecorderState(Mutex<Option<ActiveRecording>>)`. `ActiveRecording` holds the
  ffmpeg child handle (with its stdin), the region/size, the start `Instant`, and the output
  path. Only one recording at a time (R1).
- **Threading:** ffmpeg runs as its own OS process (no Rust capture loop). Spawning it and the
  windows happens off the main thread (per the new-window checklist).
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
- **Thumbnail:** after the MP4 is finalized, a quick `ffmpeg -i <out>.mp4 -ss 0 -vframes 1
  -vf scale=480:-1 <thumb>.png` writes a first-frame PNG into the existing thumbs dir. The
  recorder owns this — no call into `capture/`.

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
- **ffmpeg exits early / capture failure:** detect the dead child, tear down the control bar,
  toast a clear message; if no usable MP4 was produced, discard.
- **Stop almost immediately (sub-second):** still finalize via `q`; if the file is empty/
  unplayable, discard (no Library row) and toast "Recording too short."
- **App quit while recording:** best-effort graceful stop on shutdown — send `q` and wait
  briefly so the MP4 is finalized rather than corrupted.
- Every failure path gives visible feedback (toast) — never silent (project rule).

## Testing strategy

- **Pure/unit-testable (Rust):** ffmpeg arg-string construction, region→crop geometry,
  output path/filename building, elapsed-time formatting, the "too short → discard" decision.
  These are extracted as pure functions and unit-tested.
- **Not unit-testable (require a display/GPU/ffmpeg runtime):** the ffmpeg sidecar spawn,
  the actual capture, window creation. Verified by `cargo build` + a manual **at-screen
  acceptance** checklist (record region + fullscreen, stop, file plays, Library row +
  thumbnail appear, cancel discards, error toasts fire).
- Frontend: `tsc` + `vitest` (no new logic-heavy units; the control bar timer formatting can
  get a small test).

## Open technical risks (to validate early in the plan)

1. **ffmpeg sidecar bundling** in Tauri v2 (`externalBin`, per-target binary naming
   `ffmpeg-x86_64-pc-windows-msvc.exe`, the `shell`/process permission to spawn it). Validate
   a trivial `ffmpeg -version` spawn first (Task 1's spike).
2. **ddagrab vs gdigrab availability** — `ddagrab` needs a recent ffmpeg build and a working
   Desktop Duplication path; the recorder tries `ddagrab` and **falls back to `gdigrab`** on
   failure. R1 may ship gdigrab-first and treat ddagrab as an enhancement.
3. **Region offset/size validity** — gdigrab needs integer physical-pixel offset/size within
   the monitor; clamp/validate the selector's rect (and even/round dims for yuv420p).
4. **Clean finalization** — sending `q` (not kill) must yield a playable MP4 (`+faststart`); verify the
   moov atom is written on normal stop and on app-quit.

## Deferred (explicitly not in R1)

- **R2:** system audio + microphone (ffmpeg `dshow` inputs), each independently
  toggleable/mutable, muxed into the MP4. Control-bar audio toggles.
- **R3:** webcam overlay (composited bubble, position/size), recorded into the video.
- Also later: in-app player, frame-rate/quality settings, window-target recording,
  pause/resume, multi-monitor, countdown on/off preference.
