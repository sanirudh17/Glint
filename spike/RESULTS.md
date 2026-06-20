# Phase 0 spike — results (2026-06-20)

**Gate: PASS** (pending one human eyeball — see below).

## What was proven
`scap` (primary display) → capture thread keeps "latest frame" → CFR writer thread →
`ffmpeg` sidecar over stdin (`rawvideo bgra`) → H.264 MP4.

| Metric | Value |
|---|---|
| Encoder auto-selected | `h264_nvenc` (NVIDIA hardware) |
| Capture size | 1920×1080 |
| Real frames from scap (12s) | 564 (~47fps available) |
| Frames written (CFR @30) | 360 (57 duplicated during idle) |
| Wall-clock | 11.97s |
| `spike.mp4` duration | 12.00s — **0.00% drift** |
| File | 16.4 MB, h264 / yuv420p / 30fps / 360 frames, decodes with 0 errors |

CFR + duplicate-last-frame pacing works: output duration matches wall-clock exactly and
playback is steady regardless of the irregular desktop-duplication frame delivery.

## Human check still needed
Open `spike.mp4` and confirm (a) motion is smooth and (b) **colors are correct** (not
red/blue swapped) — that confirms the BGRA byte order is being fed to ffmpeg correctly.

## CRITICAL finding for Phase 6 (the real recorder)
`scap 0.0.8` (latest on crates.io) does **not** build against the `windows-capture`
versions cargo resolves by default:
- `windows-capture 1.5.0` — `Settings::new` now takes 8 args → scap fails to compile.
- `windows-capture 1.3.6` — too old, missing `capture::Context` / `as_nopadding_buffer`.
- **`windows-capture 1.4.4` — the working pin.** Enforced via
  `cargo update -p windows-capture --precise 1.4.4` (see `Cargo.lock`).

Implication: scap is effectively unmaintained against current deps. For the production
recorder (P6) we must either pin `windows-capture = "=1.4.4"` explicitly, vendor scap, or
evaluate calling `windows-capture` directly (it's the real engine under scap anyway).

## Notes carried forward
- Windows full-display frames come back as the **raw padded GPU buffer** (row pitch may
  exceed `width*4`); we de-stride into a packed buffer before feeding ffmpeg. Production
  capture must do the same.
- Spike uses system ffmpeg on PATH; production bundles ffmpeg as a Tauri sidecar.
- Audio was intentionally excluded — it gets its own mini-spike in P6.
