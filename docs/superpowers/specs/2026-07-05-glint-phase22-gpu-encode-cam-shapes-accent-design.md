# Glint Phase 22 — GPU H.264 encode · webcam shapes · app-wide accent

**Date:** 2026-07-05
**Branch:** `phase-22-gpu-encode-cam-shapes-accent` (off `master`)
**Status:** Design approved — ready for implementation plan

## Summary

Three independent tracks shipped as one phase, one spec:

- **Track A — Hardware H.264 encoder.** Move H.264 encoding off the CPU onto the GPU
  (NVENC / QuickSync / AMF) during recording, so capture reaches a true 60fps and frees the
  CPU. Fully automatic, mirroring the existing ddagrab capture-engine probe. Falls back to
  libx264 so recording can never break.
- **Track B — Webcam shapes.** Offer four bubble shapes — **circle** (current) + **rounded
  rectangle**, **square**, **full rectangle** — chosen at record time (live bubble is WYSIWYG)
  and editable after recording in the trim editor for movable webcams.
- **Track C — App-wide accent color.** Fix the accent setting so it reaches every window
  (OCR, trim editor, HUD, pin, editor, library), not just the home screen and sidebar.

All recorder work stays inside the isolated `recorder/` module. The accent track is
CSS-only. No new Cargo or npm dependencies.

## Motivation

- **Track A:** Phase 19 delivered true-60fps *capture* via ddagrab, but measured throughput
  averaged ~46fps because `libx264 -preset ultrafast` can't encode a full-resolution 60fps
  stream in real time on the CPU. The GPU has a dedicated H.264 encoder sitting idle. Offloading
  the encode is the single change that unlocks a smooth, full-rate recording and lowers CPU /
  heat / dropped-frame risk on a busy machine. This was already parked as a "deferred recorder
  follow-up" on the roadmap.
- **Track B:** Phase 21 made the webcam an independent, repositionable layer but left it a fixed
  circle. Rounded-rectangle "talking-head" framing is the common CleanShot/Loom look; shapes are
  a natural extension of the now-editable webcam layer.
- **Track C:** Picking a non-default accent (e.g. Teal) only recolors the home screen and sidebar
  tabs; the OCR panel, trim editor, and other surfaces stay periwinkle. The accent should own the
  whole app.

## Non-goals

- Hardware encoding of the **trim export** pass (deliberately deferred — export is a batch step
  with frame-accuracy sensitivity; the visible win is in live capture). Trim export keeps libx264.
- A **zero-copy GPU pipeline** (ddagrab → NVENC without `hwdownload`). Higher throughput but
  fragile vendor-specific hardware-frame interop, NVIDIA-only benefit, and it would entangle the
  FX-overlay compositing. Parked as a possible future optimization.
- Any **user-facing toggle** for hardware acceleration. It is fully automatic, exactly like the
  ddagrab engine selection (probe + fallback, no UI).
- Freeform / per-shape **aspect editing** of the webcam (width and height independently). Resize
  stays a single center-anchored corner handle; each shape carries a fixed aspect.

---

## Track A — Hardware H.264 encoder

### Approach

Approach A of three considered (session probe + system-memory encode; the other two — a
zero-copy GPU pipeline, and hardcoding NVENC — were rejected as high-risk/non-universal). It
mirrors the proven ddagrab capture-engine probe pattern already in `recorder/mod.rs`.

### Components

**`recorder/ffmpeg.rs`**

- New enum:
  ```rust
  #[derive(Clone, Copy, Debug, PartialEq, Eq)]
  pub enum VideoEncoder { Libx264, Nvenc, Qsv, Amf }
  ```
- `build_ffmpeg_args` gains an `encoder: VideoEncoder` parameter. The fixed libx264 tail
  (`-c:v libx264 -preset ultrafast -pix_fmt yuv420p`) is replaced by a per-encoder tail:
  - **Libx264:** `-c:v libx264 -preset ultrafast -pix_fmt yuv420p` — **byte-identical to today**.
  - **Nvenc:** `-c:v h264_nvenc -preset p4 -rc vbr -cq 21 -pix_fmt yuv420p`.
  - **Qsv:** `-c:v h264_qsv -preset veryfast -global_quality 21 -pix_fmt yuv420p`.
  - **Amf:** `-c:v h264_amf -quality balanced -rc cqp -qp_i 21 -qp_p 21 -pix_fmt yuv420p`.
  - Every encoder outputs **H.264 / yuv420p**, so segment concat (`-c copy`), the trim editor,
    and players are unchanged.
- Frames keep flowing through the existing capture path unchanged (gdigrab `-i desktop`, or
  ddagrab `hwdownload,format=bgra`); the hardware encoder re-uploads the system-memory frames.
  No change to the video-input or filter-graph construction.

**`recorder/mod.rs`**

- `static VIDEO_ENCODER: OnceLock<VideoEncoder>` — session-wide cache, mirroring `DDAGRAB_OK`.
- `async fn probe_video_encoder(app) -> VideoEncoder`: if cached, return it. Otherwise test each
  hardware encoder in priority order **NVENC → QSV → AMF** with a tiny probe:
  ```
  ffmpeg -nostats -loglevel error -f lavfi -i color=c=black:s=256x256:r=30
         -frames:v 5 -c:v <encoder> <rate-control> -f null -
  ```
  bounded by a 4s timeout (same shape as the ddagrab probe). First encoder that exits 0 wins;
  any failure/timeout falls through to the next, and if all fail, `Libx264`. Cache the result.
  Log the chosen encoder.
- `ActiveRecording` gains `pub encoder: VideoEncoder`, chosen **once** at `recorder_start`
  alongside the capture engine and reused for every segment (pause/resume) — the concat-copy
  homogeneity rule that already governs the engine now also governs the encoder.
- `spawn_segment` threads the encoder into `build_ffmpeg_args`.
- **Never-breaks fallback:** if a hardware encoder was chosen but segment 0 fails to spawn or
  exits immediately with an error, demote the session to `Libx264` (overwrite the cache), log a
  warning, and retry segment 0 once. Later segments then inherit libx264, staying concat-copy
  compatible. (The probe already validates a real encode, so this is a rare belt-and-suspenders.)

**`tray.rs` and any other `build_ffmpeg_args`/`spawn_segment` call sites** updated for the new
parameter.

### Error handling

- Probe spawn error, non-zero exit, or timeout → try next encoder → ultimately libx264. Never fatal.
- Segment-0 hardware failure → one-shot demotion to libx264 (above).
- RDP / headless / GPU-absent machines simply fail every hardware probe and record on libx264,
  exactly as they do today.

### Testing

- Extend the existing `build_ffmpeg_args` unit tests: assert each `VideoEncoder` emits the
  correct `-c:v` value and that `-pix_fmt yuv420p` is present for all; assert the `Libx264`
  argument vector is unchanged from the pre-Phase-22 baseline (protects concat-copy + the
  existing gdigrab/ddagrab byte-identity tests).
- The probe itself shells out to ffmpeg and is not unit-tested (consistent with the un-unit-tested
  ddagrab probe); it is covered by at-screen acceptance.

---

## Track B — Webcam shapes

### Shapes

`circle` (default) · `rounded` (rounded rectangle, native webcam aspect) · `square` (1:1) ·
`rect` (full rectangle, native aspect, no mask).

### Data model

- New setting `webcam_shape: WebcamShape` (Rust enum + string in the settings store), default
  `circle`, persisted via the existing dual-path (`saveSetting` + `persistSetting`) and hydrated
  at startup like the other recorder settings.
- **`camOverlay.ts` becomes aspect-aware.** Placement stays normalized `{ x, y, size }` (a single
  scalar so resize remains one center-anchored corner handle), but each shape carries an aspect
  ratio:
  - `circle`, `square` → 1:1.
  - `rounded`, `rect` → the webcam's **native** aspect (read from `videoWidth/videoHeight` at
    trim time; a sensible 16:9 default before metadata loads).
  - `toPixels(placement, shape, videoAspect, box)` returns even source-pixel width/height
    (height derived from width via the shape's aspect). `videoRectInBox` / `clampPlacement`
    updated to respect the aspect. Fully unit-tested per shape.

### Live bubble (record time)

- `RecCam.tsx` reads `webcam_shape` from settings (like it already reads `webcam_device_id`) and
  applies the shape as CSS on the bubble: `border-radius` (50% circle / a fixed radius for rounded
  & square / 0 for rect) and the container aspect (1:1 vs native). The bubble window is already
  transparent, so shaped corners show the desktop behind them.
- A **shape-cycle control** on the region selector's webcam sub-row (adjacent to the Movable
  sub-chip), seeded from the setting, cycles circle → rounded → square → rect. This makes the
  live bubble WYSIWYG for the recording.
- **Baked-in (non-movable) mode requires no backend work**: the shaped bubble is on-screen CSS,
  so gdigrab/ddagrab records the shape for free — identical to how the circle bakes in today.

### Movable mode (persist + trim editor)

- The chosen shape is persisted into the sidecar placement file (`.cam.json`) alongside
  `x/y/diameter` — `recorder/cam.rs` `write_cam_placement` / `read_cam_placement` extend to carry
  the shape string; `recorder/trim.rs` probe reads it into `ProbeResult`.
- `TrimCamOverlay.tsx` renders the persisted shape (CSS, matching the live bubble) and gains a
  **shape control** in the cam cluster so the shape can be changed after recording — consistent
  with editing position and size.
- Export mask branches per shape in `build_trim_args` (`recorder/trim.rs`), applied to the cam
  input with the **same per-segment trim/setpts** as today:
  - **circle:** `crop='min(iw,ih)':'min(iw,ih)'` → `scale=D:D` → circular alpha `geq` (current path).
  - **square:** `crop='min(iw,ih)':'min(iw,ih)'` → `scale=D:D` → rounded-corner alpha `geq` with a
    **small** radius (matching the CSS bubble's slightly-rounded corners).
  - **rounded:** keep native aspect → `scale=W:H` → rounded-corner alpha `geq` with a **larger**
    radius (rounded-rect SDF: `a = 255` inside the rounded rectangle, 0 outside).
  - **rect:** keep native aspect → `scale=W:H`, **no mask** (simplest — just overlay).
  - Overlay position uses the source-pixel top-left from `toPixels`, then fades as today.
  - When no cam is present, the export path is **byte-identical to before** (the whole cam branch
    is skipped) — preserving the Phase 21 guarantee.

### Error handling

- Unknown/legacy shape string in a `.cam.json` → default to `circle`.
- The existing E1 guard (drop the overlay + toast if the cam sidecar is missing/truncated) is
  unchanged and shape-agnostic.

### Testing

- `camOverlay.test.ts` extended: `toPixels` / `clampPlacement` / `videoRectInBox` per shape
  (1:1 vs native aspect; even dimensions; clamping at edges).
- `trim.rs` builder tests: each shape produces the expected crop/scale and mask (or absence of
  mask) in the filter graph; the no-cam path stays byte-identical.

---

## Track C — App-wide accent color

### Root cause (verified)

`applyAccent()` writes `--accent` / `--accent-hover` / `--accent-subtle` onto
`document.documentElement`, and it runs on mount in **every** window (all windows mount the same
`<App/>`, whose `loadSettings()` calls it). The variables are therefore set everywhere. The bug is
that many views **hardcode** the default accent instead of reading the variable — e.g. `trim.css`
hardcodes `#5b7cfa` in the primary button, progress fill, and clip borders (and uses
`var(--accent)` in only one spot), and `ocr.css` uses the accent variable **zero** times. So those
surfaces stay periwinkle regardless of the setting.

### Fix

A systematic audit-and-replace: every hardcoded accent-role color becomes the variable.

- Solid accent fills / borders / text → `var(--accent)`.
- Hover shades → `var(--accent-hover)`.
- Low-opacity washes / selected backgrounds → `var(--accent-subtle)`, or
  `color-mix(in srgb, var(--accent) <n>%, transparent)` for alpha variants (the pattern already
  used in `hud.css`).
- Files in scope (audit all; these are the known offenders): `recorder/trim.css`, `ocr/ocr.css`,
  `views/editor/editor.css`, `hud/hud.css`, `pin/pin.css`, `views/library.css`, plus any
  component with a baked accent-equivalent color. Colors that are intentionally
  **not** accent-driven (semantic red/green, neutral grays) are left alone.
- No JavaScript change is expected — `applyAccent` already runs in each window. Verify the OCR and
  trim windows do reach `loadSettings` on mount (they mount `<App/>`, so they do).

### Error handling / risk

- Pure CSS; the only risk is over-replacing a color that was intentionally fixed. Mitigation:
  replace only colors matching the default-accent family (`#5b7cfa` and its `rgba(91,124,250,…)`
  variants) plus obvious accent-role blues, and eyeball each site.

### Testing

- CSS has no unit tests; acceptance is an at-screen sweep of every window (home, settings, editor,
  HUD, pin, OCR panel, trim editor) with a **non-default accent (Teal)** confirming the accent is
  applied consistently and nothing semantic (error red, success green) was recolored.

---

## Cross-cutting

- **Recorder isolation** honored: Track A and B live entirely in `recorder/` (`ffmpeg.rs`,
  `mod.rs`, `cam.rs`, `trim.rs`, `windows.rs`) plus their frontend counterparts; nothing new is
  imported from capture/editor/overlay/ocr. Track C touches only stylesheets.
- **No new dependencies** (Cargo or npm).
- **Green gate** (all tracks, before merge): from `glint/src-tauri` — `cargo clippy --all-targets`
  (0 warnings) + `cargo test`; from `glint` — `npx tsc --noEmit` + `npx vitest run`.
- **Merge:** `phase-22-gpu-encode-cam-shapes-accent` → `master` with `--no-ff`, after at-screen
  acceptance.

## At-screen acceptance checklist

- **A:** Record on the RTX 4050 → log shows the NVENC encoder chosen; output plays; measured fps
  is at/near 60 at full resolution; pause/resume produces a clean concatenated file. Force a
  fallback (or reason about a non-GPU machine) → libx264 still records.
- **B:** For each of the four shapes: the live bubble shows the shape while recording; a baked-in
  recording bakes the shape; a movable recording opens in the trim editor with the same shape,
  the shape is changeable there, and export composites the shape correctly (masked edges for
  rounded/circle). No-cam recordings export byte-identically to before.
- **C:** With Teal selected, every window (home, settings, editor, HUD, pin, OCR, trim) shows Teal
  accents; no semantic colors were recolored.
