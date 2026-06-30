# Phase 8 R2 — Recorder Audio (system + microphone)

**Date:** 2026-06-29
**Branch:** `phase-8-recorder-r2`
**Status:** Design approved, awaiting spec review → plan

## Goal

Add audio to the screen recorder: **system audio** (what's playing) and **microphone**,
each independently selectable before a recording and **mutable live** during one, mixed
and muxed into the same MP4 as the video. Local-first, no admin, no third-party driver.

## Binding constraints (unchanged)

- Everything stays on device. No cloud, upload, accounts, or network calls.
- Single-user. No login/auth/admin. **No installer or driver requiring elevation** — this
  is why system audio uses WASAPI loopback, not a virtual DirectShow device.
- **Recorder isolation is SACRED.** Everything here lives under `recorder/` and imports
  nothing from `capture/`, `editor/`, or `overlay/`. The only outbound coupling stays the
  same as R1: on stop, write the MP4 + insert one Library row.

## Approach (chosen: A — live pipes per segment)

Each recording already runs as one or more **segments** (a fresh ffmpeg per pause/resume
span; stop concatenates them with stream-copy). R2 extends a segment to also carry audio,
so the entire pause/resume/concat machinery is reused untouched.

```
WASAPI loopback (system) ─┐  [Rust thread] → \\.\pipe\glint-sys ─→ ffmpeg ─┐
                          │                                                 ├─ amix → AAC
WASAPI capture (mic) ─────┘  [Rust thread] → \\.\pipe\glint-mic ─→ ffmpeg ─┘   + gdigrab video
                                                                          → segment .mp4 (A+V)
```

- Rust captures each enabled source on a background thread and writes raw interleaved PCM
  (`f32le`) into a per-source **Windows named pipe**.
- ffmpeg reads each pipe as an input (`-f f32le -ar <rate> -ac <ch> -i \\.\pipe\…`),
  mixes active sources with `aresample=async=1` (resamples + holds A/V sync against drift),
  encodes `aac`, and muxes alongside the gdigrab video into the segment MP4. **Two** active
  sources combine via `amix=inputs=2`; a **single** active source is mapped directly (no
  `amix`); **zero** sources emit no audio args at all.
- **Stop concat is unchanged** — `-c copy` copies both the video and audio streams of each
  segment into the final file.
- **Zero audio sources** → identical to R1 (silent video; no pipes, no audio args).

### Alternatives rejected
- **B — separate WAV, mux once at stop:** simpler real-time path but real A/V-drift risk
  over long takes and it fights the segment model (audio would need its own segmenting +
  offset alignment). Worse sync for more bookkeeping.
- **C — hybrid (mic via ffmpeg dshow, system via pipe):** halves the Rust audio code but
  reintroduces dshow device-name fragility and a second timestamp domain to reconcile. Not
  worth it once WASAPI infra exists for system audio anyway.

## Components (all under `recorder/`)

| Unit | Responsibility | Testable? |
|------|----------------|-----------|
| `recorder/audio.rs` (new) | WASAPI capture: open system-loopback + mic clients (`wasapi` crate), pump PCM frames into named pipes; honor a live mute flag (write silence instead of stopping, to preserve the timeline). Thin imperative layer. | At-screen + a focused spike; minimal pure logic. |
| `recorder/ffmpeg.rs` (extend) | `build_ffmpeg_args` gains audio inputs + the `amix`/`aresample`/`aac` tail when sources are active. **Pure** — the deterministic core. | **Unit-tested** (primary test surface). |
| `recorder/mod.rs` (extend) | `Segment` gains audio capture/pipe teardown handles; start/pause/resume/stop drive the audio-thread lifecycle in lockstep with ffmpeg. | Lifecycle by at-screen; arg/state mapping unit-tested. |
| `recorder/pipes.rs` (new, small) | Create/serve the Windows named pipes (tokio `named_pipe`), hand paths to ffmpeg, accept the connection, expose a writer to the capture thread. | Spike-validated. |

**New dependencies:** `wasapi` (Windows WASAPI capture + loopback), and the tokio `net`
feature (Windows named pipes). Both Windows-only, consistent with the app target.

## Audio source selection & live mute

- **Settings (persisted defaults):** *Record system audio* = **on**, *Record microphone* =
  **off**. Uses the OS **default** output (for loopback) and default input (mic). Device
  pickers are deferred (YAGNI for R2).
- **Region-selector toolbar:** two small toggle chips — **System** / **Mic** — seeded from
  settings, letting the user choose sources for *this* recording before dragging a region
  or hitting Record Full Screen. This is the pre-record selection.
- **Privacy:** a source is **only opened/captured if enabled at start**. The mic is never
  opened unless the user turned it on — no always-listening capture.
- **Control bar (live):** a small toggle per **active** source mutes/unmutes it during the
  recording by writing **silence** into that pipe (keeps the stream continuous and synced).
  Sources that were off at start don't appear (re-enabling one needs a new recording).

## Lifecycle & teardown ordering

- **Start (segment 0):** resolve enabled sources → create their pipes → build ffmpeg args
  with matching inputs → spawn ffmpeg → accept pipe connections → start capture threads.
- **Pause:** send ffmpeg `q` and wait for `Terminated` (existing), then stop the segment's
  capture threads and close its pipes. Order matters: ffmpeg finalizes on `q` first, then
  audio threads see the broken pipe and exit — never close pipes before ffmpeg flushes, or
  an input EOF can truncate the segment.
- **Resume:** new segment = new pipes + new ffmpeg + new capture threads.
- **Stop:** finish the running segment (as pause), then concat segments (`-c copy`, both
  streams) into the final MP4; thumbnail + Library row as R1.
- **Cancel:** stop threads, kill ffmpeg, delete all segment files.

## Error handling

- Mic missing / permission denied / no default device → skip that source, toast
  ("Microphone unavailable — recording system audio only"), continue.
- All audio unavailable → fall back to **silent video** (never block the recording).
- Pipe create/connect failure for a source → drop that source with a toast; if both drop,
  silent video.
- Teardown failures log and never corrupt the MP4 (q-then-wait preserved).

## Testing

- **Unit (pure):** `build_ffmpeg_args` for the matrix {none, system-only, mic-only, both} —
  asserts the right number of `-f f32le` inputs, the `amix=inputs=N` / `aresample=async=1`
  filter, `-c:a aac`, and that the no-audio case is byte-identical to R1's args. Source→pipe
  mapping and the enabled-sources resolution logic.
- **Spike first:** a minimal named-pipe ⇄ ffmpeg + WASAPI loopback probe (mirrors R1's
  ffmpeg health-check) to de-risk the one novel mechanism before building on it.
- **At-screen acceptance:** system-only, mic-only, both; live mute each mid-recording;
  pause/resume with audio; A/V sync over a 60s+ take; absent-mic fallback.

## Scope guard (YAGNI — explicitly out for R2)

Device pickers, per-source volume sliders, waveform/level meters, noise suppression,
audio-only recording. R2 is: pick sources (defaults + per-recording toggles), live mute,
mixed AAC in the MP4.

## Primary risk

The **named-pipe ⇄ ffmpeg handshake on Windows** (pipe naming, connect timing, format
negotiation, sync offset). Retired by the spike task before it gates the rest of the build.
A/V sync offset, if audible, is tuned with `-itsoffset` / `aresample=async=1` during
at-screen acceptance.
