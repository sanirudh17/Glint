# Phase 19 — Recorder Fidelity Pack (Design Spec)

**Date:** 2026-07-03
**Branch (to be created):** `phase-19-recorder-fidelity`
**Status:** Approved design — ready for implementation plan

## Goal

Three independent, reliability-first quality improvements to the recorder, each
individually shippable and each with a safety net so recording never breaks:

1. **Webcam device picker** — choose which camera the bubble uses.
2. **True 60 fps capture** — replace GDI-based `gdigrab` with GPU-based `ddagrab`
   (Desktop Duplication API), which can genuinely sustain 60 fps.
3. **Higher-fidelity microphone** — better voice timbre via format + DSP handling,
   entirely in WASAPI shared mode (exclusive mode deliberately rejected — see §3).

Non-goals (explicitly out of scope, stay deferred): independent post-hoc webcam
layer, mic exclusive-mode capture, trim-editor upgrades.

---

## §1 — Webcam device picker

### Current state
`RecCam.tsx` (route `#/rec-cam`) opens the webcam bubble with
`navigator.mediaDevices.getUserMedia({ video: true, audio: false })` — always the
**system default** camera. There is no way to choose a different camera.

### Design
- Add a **Camera** dropdown to **Settings › Recording** (`settings/Recording.tsx`),
  consistent with the existing fps/mic controls. The bubble stays visually minimal
  (no new controls on the overlay itself).
- Enumerate cameras with `navigator.mediaDevices.enumerateDevices()`, filtering to
  `kind === "videoinput"`. The first option is always **"System default"** (maps to
  today's `video: true`), followed by each enumerated device.
- Persist the chosen `deviceId` through the standard dual path: in-memory
  `SettingsState` (`webcam_device_id: String`, default `""` = system default) via
  `settings_set`, **and** SQLite via `persistSetting`. Hydrated at startup like every
  other setting.
- `RecCam.tsx` reads the persisted `deviceId` and requests
  `getUserMedia({ video: id ? { deviceId: { exact: id } } : true, audio: false })`.

### Boundaries / graceful cases
- **Labels require permission:** browsers return empty `label` fields from
  `enumerateDevices()` until camera permission has been granted at least once. Until
  then the dropdown shows generic names ("Camera 1", "Camera 2"…) with a one-line hint
  ("Camera names appear after first use"). After the first webcam session, real names
  populate. "System default" is always labelled correctly.
- **Stale/unplugged device:** if the saved `deviceId` no longer exists,
  `getUserMedia({ deviceId: { exact } })` rejects. `RecCam.tsx` catches this, retries
  once with `video: true` (system default), and emits a `glint-toast`
  ("Saved camera unavailable — using default") so the bubble never comes up black.

### Files
`settings/mod.rs` (new field + `apply_update` arm + test), `settings/Recording.tsx`,
`store/useAppStore.ts` (Settings field + setter), `lib/recorder.ts` (if a helper is
needed to fetch the id), `recorder/RecCam.tsx`.

### Risk
Low. Frontend-heavy; the Rust change is one settings field mirroring the existing
pattern.

---

## §2 — True 60 fps via ddagrab

### Current state
`ffmpeg.rs::build_ffmpeg_args` captures video with:
```
-f gdigrab -framerate <fps> [-draw_mouse 0] [-offset_x/-offset_y/-video_size] -i desktop
```
`gdigrab` is GDI/CPU-based and realistically cannot sustain a true 60 fps on a full
desktop. The bundled ffmpeg sidecar **does** include `ddagrab` (verified: supports
`framerate`, `video_size`, `offset_x`, `offset_y`, `draw_mouse`).

### Design
Replace the gdigrab video input with a `ddagrab` filter-graph source. ddagrab emits
D3D11 hardware frames, so a `hwdownload,format=bgra` step brings them to system memory
before the **unchanged** libx264 / yuv420p / faststart encode:

```
-init_hw_device d3d11va
-filter_complex "ddagrab=output_idx=0:draw_mouse=0:framerate=<fps>[:video_size=WxH:offset_x=X:offset_y=Y],hwdownload,format=bgra[v]"
-map "[v]"
<audio inputs / filter as today>
-c:v libx264 -preset ultrafast -pix_fmt yuv420p ... -movflags +faststart <out>
```

Key invariants preserved:
- **Audio pipeline untouched.** Named-pipe audio inputs, the mic/system filter graph,
  the silent-`anullsrc` pad, and stream mapping are exactly as today. Video is now the
  filter output `[v]` instead of input `0:v`; `-map "[v]"` replaces `-map 0:v`, and
  audio inputs shift to start at input `0` (there is no `-i desktop` anymore — ddagrab
  is a source *filter*, not an input). The arg-builder handles this index shift.
- **FX pointer overlay still captured.** ddagrab captures the *composed* desktop, so
  the layered FX overlay window (custom pointer / keystrokes) still appears. `draw_mouse`
  stays `0`; the FX overlay draws the pointer, as today.
- **Region capture** uses ddagrab's `offset_x/offset_y/video_size` (crop at source).
- **Multi-monitor** stays primary-only (consistent with Phase 17's documented limitation);
  `output_idx=0`.

### Fallback (the safety net)
- Engine is chosen **once** at `recorder_start` and reused for **every** pause/resume
  segment, so all segments share identical output stream params (the concat `-c copy`
  invariant is preserved — a mixed ddagrab/gdigrab recording is never produced).
- If the ddagrab-based ffmpeg fails to start the **first** segment (init failure —
  e.g. RDP session, unsupported virtual display), `recorder_start` rebuilds the args
  with the current **gdigrab** path and retries once. Detection is via the existing
  segment-start/first-frame health signal; if the first segment never produces output
  within the existing startup window, treat it as a ddagrab failure and fall back.
- If gdigrab also fails, surface the existing error path (unchanged).

### Arg-builder shape
`build_ffmpeg_args` gains an engine selector (enum `CaptureEngine::Ddagrab | Gdigrab`)
so both paths are produced by the same pure function and unit-tested side by side:
- ddagrab args: assert `ddagrab` source present, `framerate=<fps>`, `hwdownload,format=bgra`,
  region → `offset_x/offset_y/video_size` inside the filter, `-map "[v]"`, audio input
  indices start at 0, output params identical to gdigrab path.
- gdigrab args: unchanged from today (existing tests keep passing).
- Both: identical `-c:v libx264 … +faststart <out>` tail (concat-copy homogeneity).

### Files
`ffmpeg.rs` (engine enum + branch + tests), `recorder/mod.rs` (`recorder_start`:
choose engine, first-segment fallback, keep engine across segments).

### Risk
Highest of the three, but isolated to `ffmpeg.rs` (pure, unit-tested) plus the
`recorder_start` orchestration. The fallback bounds real-world risk: any setup where
ddagrab won't initialize silently gets the proven gdigrab path.

---

## §3 — Higher-fidelity microphone (shared mode; exclusive mode rejected)

### Decision rationale (why NOT exclusive mode)
Exclusive-mode WASAPI capture at the mic's native format was considered and
**deliberately rejected** for a screen recorder:
- Exclusive mode **locks the device** — it fails whenever another app holds the mic
  (Zoom/Teams/Discord/browser), which is the *common* case during screen recording,
  not the edge case. It would fail exactly when invoked, then fall back anyway.
- The real-world fidelity gain is marginal: on Windows 10/11 the shared mix format is
  already 48 kHz float for virtually every consumer mic. Exclusive only helps >48 kHz
  studio interfaces, which this tool's users rarely have.
- It drops WASAPI `AUTOCONVERTPCM`, forcing manual handling/resampling of arbitrary
  native sample types — more code and failure surface for inaudible benefit.

The reliable, always-available improvement is in **format + DSP handling**, all in
shared mode.

### Current state
`audio.rs` opens the default capture device, reads `get_mixformat()` for rate/channels,
requests 32-bit float with `AUTOCONVERTPCM`. `ffmpeg.rs` then applies a fixed voice-EQ
chain to the mic (`MIC_FX`):
```
pan=stereo|c0=c0|c1=c0,            # hard-collapse to channel 0 (mono)
highpass=f=80,                      # de-rumble
equalizer=f=400:g=-2,               # cut "boxiness" (also thins body)
equalizer=f=3500:g=+3               # fixed presence bump
```
The "muffled/low-fi" perception traces to (a) the lossy mono-collapse (can pick the
weaker channel / hollow the image) and (b) coloring that sounds "processed" rather than
adding genuine high-frequency air.

### Design (all best-effort, silent fallback to today's exact path)
1. **Confirm best shared format.** Keep using the device mix format, but assert we are
   requesting the device's full-rate float format (guard against silently capturing a
   reduced rate). No behavioral change when already optimal.
2. **Preserve true stereo.** Stop hard-collapsing the mic to a single channel. When the
   device presents genuine stereo, keep both channels; when it's mono-in-stereo, upmix
   cleanly (no phase-tricking `pan`). This restores body/space lost by picking one channel.
3. **Re-voice the EQ for transparency.** Replace the assertive fixed chain with a lighter,
   more natural one:
   - Keep `highpass=f=80` (rumble removal is always beneficial).
   - **Drop** the −2 dB @ 400 Hz body cut.
   - **Replace** the fixed +3 dB @ 3.5 kHz bell with a **gentle high-shelf for air/clarity**
     (a modest lift above ~6–8 kHz) — the targeted fix for "muffled" (lack of highs)
     without the processed character.

   Exact filter values finalized during implementation and captured in `ffmpeg.rs` tests
   (the `MIC_FX` constant and its assertions are updated to the new chain).

### Boundaries
- Every step falls back **silently** to today's behavior on any failure; a recording is
  never lost to an audio-fidelity attempt.
- A physically low-rate source (Bluetooth hands-free / comms mic at 8–16 kHz) cannot be
  improved and is not misrepresented as improved.

### Files
`audio.rs` (format assertion / stereo handling), `ffmpeg.rs` (`MIC_FX` chain + updated
tests). System-audio (loopback) path is unchanged.

### Risk
Low–medium. DSP/format changes only; no device-lock, no new failure modes (fallback
preserved). Audible improvement is bounded but reliable.

---

## Testing strategy

- **§1:** manual camera-switch verification + settings persistence; the Rust settings
  field gets a unit test in `settings/mod.rs` (validate/round-trip) mirroring the
  existing image-format/fps tests.
- **§2:** `ffmpeg.rs` unit tests for both engines (ddagrab source, framerate, region
  crop, hwdownload, map, audio-index shift, identical encode tail; gdigrab path
  unchanged). Manual: 60 fps fullscreen + region recording; verify fallback by forcing
  ddagrab failure.
- **§3:** `ffmpeg.rs` tests asserting the new `MIC_FX` chain (high-pass kept, 400 Hz cut
  gone, high-shelf present, stereo preserved). Manual A/B voice recording.
- Full green gate before each merge: `cargo clippy` warning-clean, `cargo test`, `vitest`,
  `tsc`.

## Sequencing

Independent sub-features; recommended order by ascending risk: **§1 webcam picker →
§3 mic DSP → §2 ddagrab** (do the riskiest, most isolated ffmpeg change last with the
other wins already banked). Each can be committed and verified on its own.

## Out of scope (unchanged, project-wide)
Cloud/upload/share, teams/auth/network, scrolling capture, AI features, GIF export,
independent post-hoc webcam layer, mic exclusive-mode capture, trim-editor upgrades.
