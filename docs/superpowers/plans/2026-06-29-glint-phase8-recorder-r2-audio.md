# Phase 8 R2 — Recorder Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add system-audio + microphone capture to the screen recorder — each selectable before a recording and mutable live during one — mixed and muxed into the same MP4 as the video.

**Architecture:** Each recording already runs as one or more segments (a fresh ffmpeg per pause/resume span; stop concatenates them). R2 extends a segment to also carry audio: Rust captures each enabled source via WASAPI (loopback for system, capture for mic) on background threads, pumps raw `f32le` PCM into per-source **Windows named pipes**, and ffmpeg reads those pipes as inputs, mixes them (`amix`/`aresample=async=1`), encodes AAC, and muxes alongside the gdigrab video into the segment MP4. The existing concat-on-stop copies both streams untouched.

**Tech Stack:** Rust (Tauri v2), `tauri-plugin-shell` sidecar ffmpeg, `wasapi` crate (WASAPI capture/loopback), tokio named pipes (`net` feature), React/TypeScript frontend.

## Global Constraints

- **Local-first:** no cloud, upload, accounts, or network calls. All audio stays on device.
- **No elevation:** no installer or driver requiring admin. System audio uses WASAPI loopback, never a virtual DirectShow device.
- **Recorder isolation is SACRED:** all new code lives under `recorder/` (Rust) and `src/recorder/` (TS) and imports nothing from `capture/`, `editor/`, or `overlay/`. Only outbound coupling stays: on stop, write the MP4 + insert one Library row.
- **Windows-only** target (matches existing `winreg`/`gdigrab`/`windows` usage).
- **ffmpeg invariant:** keep `-nostats -loglevel error` (the capacity-1 sidecar channel stalls a long recording if ffmpeg's stderr is chatty and undrained).
- **Audio format:** capture interleaved `f32le`; encode `aac -b:a 192k`; mixer `amix=inputs=N:duration=longest` then `aresample=async=1`.
- Settings defaults: **record_system_audio = true**, **record_microphone = false**. OS default devices (no device pickers in R2).

---

### Task 1: ffmpeg audio args (pure core) + types + deps

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add deps)
- Modify: `glint/src-tauri/src/recorder/mod.rs` (add `AudioConfig`)
- Modify: `glint/src-tauri/src/recorder/ffmpeg.rs` (add `AudioInput`, extend `build_ffmpeg_args`, tests)

**Interfaces:**
- Produces:
  - `recorder::AudioConfig { pub system: bool, pub mic: bool }` — `#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]`
  - `recorder::ffmpeg::AudioInput { pub pipe_path: String, pub sample_rate: u32, pub channels: u16 }`
  - `recorder::ffmpeg::build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput]) -> Vec<String>` (signature gains the `audio` slice)

- [ ] **Step 1: Add dependencies**

In `glint/src-tauri/Cargo.toml`, change the tokio line and add `wasapi` (under the existing `[dependencies]`):

```toml
tokio = { version = "1", features = ["time", "net", "io-util", "sync", "rt"] }
# WASAPI capture (mic) + loopback (system audio) — install-free system audio.
wasapi = "0.15"
```

- [ ] **Step 2: Add `AudioConfig` to mod.rs**

In `glint/src-tauri/src/recorder/mod.rs`, just below the `RecordTarget` enum:

```rust
/// Which audio sources a recording captures. Resolved once at start from the
/// frontend's request; a source absent here is never opened (mic privacy).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AudioConfig {
    pub system: bool,
    pub mic: bool,
}
```

- [ ] **Step 3: Write failing tests for the audio args**

In `glint/src-tauri/src/recorder/ffmpeg.rs`, add to the `tests` module:

```rust
fn ai(rate: u32) -> AudioInput {
    AudioInput { pipe_path: format!("\\\\.\\pipe\\glint-{rate}"), sample_rate: rate, channels: 2 }
}

#[test]
fn no_audio_is_identical_to_silent_video() {
    let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[]);
    assert!(!v.iter().any(|s| s == "-c:a"));
    assert!(!v.iter().any(|s| s == "-filter_complex"));
    assert_eq!(v.last().unwrap(), "C:/o.mp4");
}

#[test]
fn one_source_maps_directly_no_amix() {
    let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)]);
    // input 0 = video (desktop), input 1 = the pipe
    assert!(v.windows(2).any(|w| w[0] == "-f" && w[1] == "f32le"));
    assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
    assert!(v.iter().any(|s| s == "-filter_complex"));
    assert!(v.iter().any(|s| s == "[1:a]aresample=async=1[aout]"));
    assert!(!v.iter().any(|s| s.contains("amix")));
    assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
    assert!(v.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
}

#[test]
fn two_sources_use_amix() {
    let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai(44100)]);
    assert!(v.iter().any(|s| s == "[1:a][2:a]amix=inputs=2:duration=longest,aresample=async=1[aout]"));
    assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
    // both rates present as input options
    assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
    assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "44100"));
}

#[test]
fn audio_inputs_carry_thread_queue_size() {
    let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)]);
    assert!(v.windows(2).any(|w| w[0] == "-thread_queue_size" && w[1] == "1024"));
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cargo test -p glint --lib recorder::ffmpeg 2>&1 | tail -20` (from `glint/src-tauri`)
Expected: FAIL — `build_ffmpeg_args` takes 3 args / `AudioInput` undefined.

- [ ] **Step 5: Implement `AudioInput` + extend `build_ffmpeg_args`**

In `glint/src-tauri/src/recorder/ffmpeg.rs`, add the struct above `build_ffmpeg_args`:

```rust
/// One ffmpeg audio input fed live from a Windows named pipe (raw f32le PCM).
pub struct AudioInput {
    pub pipe_path: String,
    pub sample_rate: u32,
    pub channels: u16,
}
```

Replace `build_ffmpeg_args` with:

```rust
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput]) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-f".into(), "gdigrab".into(),
        "-framerate".into(), fps.to_string(),
    ];
    if let RecordTarget::Region { x, y, w, h } = target {
        a.extend([
            "-offset_x".into(), x.to_string(),
            "-offset_y".into(), y.to_string(),
            "-video_size".into(), format!("{w}x{h}"),
        ]);
    }
    a.extend(["-i".into(), "desktop".into()]); // input 0 = video

    // Audio pipe inputs become input 1..=N (a generous thread_queue_size keeps the
    // live pipe from underrun-spamming ffmpeg).
    for ai in audio {
        a.extend([
            "-thread_queue_size".into(), "1024".into(),
            "-f".into(), "f32le".into(),
            "-ar".into(), ai.sample_rate.to_string(),
            "-ac".into(), ai.channels.to_string(),
            "-i".into(), ai.pipe_path.clone(),
        ]);
    }

    // Video codec (unchanged from R1).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio graph + explicit stream mapping. With extra inputs present, ffmpeg's
    // auto-map would guess; we map video from input 0 and the mixed audio output.
    match audio.len() {
        0 => {}
        1 => {
            a.extend([
                "-filter_complex".into(), "[1:a]aresample=async=1[aout]".into(),
                "-map".into(), "0:v".into(),
                "-map".into(), "[aout]".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "192k".into(),
            ]);
        }
        n => {
            let labels: String = (1..=n).map(|i| format!("[{i}:a]")).collect();
            let fc = format!("{labels}amix=inputs={n}:duration=longest,aresample=async=1[aout]");
            a.extend([
                "-filter_complex".into(), fc,
                "-map".into(), "0:v".into(),
                "-map".into(), "[aout]".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "192k".into(),
            ]);
        }
    }

    a.extend(["-movflags".into(), "+faststart".into(), out.into()]);
    a
}
```

- [ ] **Step 6: Fix existing call sites + tests for the new signature**

In `glint/src-tauri/src/recorder/mod.rs`, `spawn_segment` calls `build_ffmpeg_args(&target, fps, path)`. Temporarily pass `&[]` so the crate compiles (Task 3 rewrites this call):

```rust
    let args = ffmpeg::build_ffmpeg_args(&target, fps, path, &[]);
```

In `ffmpeg.rs` tests, the three existing tests `args_silence_stderr_to_avoid_pipe_backpressure`, `fullscreen_args_have_no_offset`, and `region_args_carry_offset_and_size` call `build_ffmpeg_args(..., out)` — add a trailing `&[]` argument to each.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cargo test -p glint --lib recorder::ffmpeg 2>&1 | tail -20`
Expected: PASS (all ffmpeg tests, old + new).

- [ ] **Step 8: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/recorder/ffmpeg.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p8 r2): ffmpeg audio args (amix/aac) + AudioInput type + deps"
```

---

### Task 2: Named pipe helper + WASAPI capture + end-to-end spike

This task retires the one novel risk: WASAPI loopback PCM → named pipe → ffmpeg. It delivers the reusable capture/pipe building blocks **and** a `recorder_audio_check` command that proves the whole chain at-screen before the lifecycle integration depends on it.

**Files:**
- Create: `glint/src-tauri/src/recorder/pipes.rs`
- Create: `glint/src-tauri/src/recorder/audio.rs`
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`pub mod pipes; pub mod audio;` + `recorder_audio_check` command)
- Modify: `glint/src-tauri/src/lib.rs` (register `recorder_audio_check`)

**Interfaces:**
- Produces:
  - `recorder::pipes::pipe_path(tag: &str, seg: usize) -> String` — returns `\\.\pipe\glint-{tag}-{seg}-{pid}` (unique per process/segment/source).
  - `recorder::pipes::create_server(path: &str) -> std::io::Result<tokio::net::windows::named_pipe::NamedPipeServer>`
  - `recorder::audio::Source` — `enum { System, Mic }`
  - `recorder::audio::CaptureFormat { pub sample_rate: u32, pub channels: u16 }`
  - `recorder::audio::start_capture(source: Source, muted: std::sync::Arc<std::sync::atomic::AtomicBool>, stop: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<(CaptureFormat, tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>, std::thread::JoinHandle<()>), String>` — opens the WASAPI client, spawns a capture thread that pushes interleaved `f32le` byte buffers into the channel until `stop`; while `muted`, pushes equal-length **silence** so the timeline stays continuous.

- [ ] **Step 1: Pipe helper (`pipes.rs`)**

```rust
//! Windows named pipes that carry raw PCM from our WASAPI capture threads into
//! ffmpeg. Recorder-owned. ffmpeg opens `\\.\pipe\NAME` as a client; we are the
//! server. One pipe per (source, segment) so spans never collide.

use std::io;
use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};

/// `\\.\pipe\glint-{tag}-{seg}-{pid}` — unique per source/segment/process so a
/// resumed span (new segment) and a second app instance never clash.
pub fn pipe_path(tag: &str, seg: usize) -> String {
    format!("\\\\.\\pipe\\glint-{tag}-{seg}-{}", std::process::id())
}

/// Create the server end of a named pipe, listening for ffmpeg to connect.
pub fn create_server(path: &str) -> io::Result<NamedPipeServer> {
    ServerOptions::new()
        .first_pipe_instance(true)
        .create(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pipe_path_shape() {
        let p = pipe_path("sys", 0);
        assert!(p.starts_with(r"\\.\pipe\glint-sys-0-"));
    }
}
```

- [ ] **Step 2: WASAPI capture (`audio.rs`)**

> **Spike note:** the exact `wasapi` crate calls (client init, `get_mixformat`, loopback flag, buffer pump) are nailed down here against the installed crate version's docs. The structure below is the contract the rest of the plan relies on — the capture thread MUST: push interleaved `f32le` byte buffers to the channel; substitute equal-length silence while `muted`; and exit cleanly when `stop` is set. Keep the deterministic edges (this signature, the silence-on-mute rule) exactly; adapt only the inner WASAPI calls.

```rust
//! WASAPI capture for the recorder: system audio via loopback, mic via normal
//! capture. Each source runs on its own thread, pushing interleaved f32le PCM
//! into an mpsc channel that a tokio task drains into a named pipe. Recorder-owned.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver};

#[derive(Clone, Copy, Debug)]
pub enum Source {
    System,
    Mic,
}

#[derive(Clone, Copy, Debug)]
pub struct CaptureFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

/// Open `source` and start capturing. Returns the negotiated format, a receiver of
/// raw f32le byte buffers, and the capture thread handle. While `muted`, the thread
/// emits equal-length silence (keeps A/V timeline + sync). On `stop`, it exits and
/// drops its sender (closing the channel, which ends the pipe pump → ffmpeg EOF).
pub fn start_capture(
    source: Source,
    muted: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
) -> Result<(CaptureFormat, UnboundedReceiver<Vec<u8>>, JoinHandle<()>), String> {
    use wasapi::*;

    initialize_mta().ok().ok_or("WASAPI COM init failed")?;

    let direction = match source {
        Source::System => &Direction::Render, // render device, opened in loopback
        Source::Mic => &Direction::Capture,
    };
    let device = get_default_device(direction).map_err(|e| format!("default device: {e}"))?;
    let mut client = device.get_iaudioclient().map_err(|e| format!("audio client: {e}"))?;
    let format = client.get_mixformat().map_err(|e| format!("mix format: {e}"))?;
    let sample_rate = format.get_samplespersec();
    let channels = format.get_nchannels();

    // Loopback for system audio; normal shared capture for the mic. Event-driven.
    let (_def, min) = client.get_periods().map_err(|e| format!("periods: {e}"))?;
    client
        .initialize_client(&format, min, direction, &ShareMode::Shared, /*loopback=*/ matches!(source, Source::System))
        .map_err(|e| format!("init client: {e}"))?;
    let h_event = client.set_get_eventhandle().map_err(|e| format!("event handle: {e}"))?;
    let capture = client.get_audiocapturclient().map_err(|e| format!("capture client: {e}"))?;
    let block_align = format.get_blockalign() as usize;

    let (tx, rx) = unbounded_channel::<Vec<u8>>();
    client.start_stream().map_err(|e| format!("start stream: {e}"))?;

    let handle = std::thread::spawn(move || {
        let mut queue: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
        while !stop.load(Ordering::Relaxed) {
            if h_event.wait_for_event(200).is_err() {
                continue; // timeout; re-check stop
            }
            if capture.read_from_device_to_deque(block_align, &mut queue).is_err() {
                break;
            }
            if queue.is_empty() {
                continue;
            }
            let mut buf: Vec<u8> = queue.drain(..).collect();
            if muted.load(Ordering::Relaxed) {
                buf.iter_mut().for_each(|b| *b = 0); // f32 zero bytes == 0.0 == silence
            }
            if tx.send(buf).is_err() {
                break; // pump dropped (pipe gone)
            }
        }
        let _ = client.stop_stream();
        // tx dropped here → channel closes → pipe pump finishes.
    });

    Ok((CaptureFormat { sample_rate, channels }, rx, handle))
}
```

- [ ] **Step 3: Wire `pub mod` + spike command in `mod.rs`**

Add near the top of `mod.rs`:

```rust
pub mod audio;
pub mod pipes;
```

Add the spike command (records ~1.5s of system audio through the full chain to a temp `.m4a`, returns its size — proves WASAPI→pipe→ffmpeg end to end):

```rust
/// Spike/health-check for the audio chain: capture ~1.5s of SYSTEM audio via
/// WASAPI loopback → named pipe → ffmpeg → temp .m4a, and return the byte size.
/// Run once at-screen (with sound playing) to confirm the mechanism before the
/// recorder depends on it. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_audio_check(app: tauri::AppHandle) -> Result<u64, String> {
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use tokio::io::AsyncWriteExt;

    let stop = Arc::new(AtomicBool::new(false));
    let muted = Arc::new(AtomicBool::new(false));
    let (fmt, mut rx, handle) =
        audio::start_capture(audio::Source::System, muted, stop.clone())?;

    let path = pipes::pipe_path("probe", 0);
    let mut server = pipes::create_server(&path).map_err(|e| format!("pipe: {e}"))?;

    let out = std::env::temp_dir().join("glint-audio-probe.m4a");
    let out_str = out.to_string_lossy().to_string();
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("sidecar: {e}"))?;
    let (_rx2, child) = sidecar
        .args([
            "-y", "-loglevel", "error",
            "-thread_queue_size", "1024",
            "-f", "f32le", "-ar", &fmt.sample_rate.to_string(), "-ac", &fmt.channels.to_string(),
            "-i", &path, "-t", "1.5", "-c:a", "aac", &out_str,
        ])
        .spawn()
        .map_err(|e| format!("spawn: {e}"))?;

    server.connect().await.map_err(|e| format!("connect: {e}"))?;
    // Pump for ~1.5s, then stop.
    let pump = tokio::spawn(async move {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(1500);
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(std::time::Duration::from_millis(300), rx.recv()).await {
                Ok(Some(buf)) => { let _ = server.write_all(&buf).await; }
                _ => {}
            }
        }
    });
    let _ = pump.await;
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = handle.join();
    drop(child); // ffmpeg sees EOF / closes
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    std::fs::metadata(&out_str).map(|m| m.len()).map_err(|e| format!("no output: {e}"))
}
```

Register it in `glint/src-tauri/src/lib.rs` alongside `recorder::recorder_ffmpeg_check`:

```rust
            recorder::recorder_audio_check,
```

- [ ] **Step 4: Unit test the pipe helper**

Run: `cargo test -p glint --lib recorder::pipes 2>&1 | tail -10`
Expected: PASS (`pipe_path_shape`).

- [ ] **Step 5: Build the backend**

Run: `cargo build -p glint 2>&1 | tail -20` (from `glint/src-tauri`)
Expected: Finished, no errors. (Resolve any `wasapi` API drift here against the crate docs, preserving the `start_capture` signature + silence-on-mute contract.)

- [ ] **Step 6: At-screen spike verification**

Run the app (`npm run tauri dev`), play audible sound, then from the frontend devtools console run `window.__TAURI__.core.invoke('recorder_audio_check')`. Expected: resolves to a number **> 1000** (a non-empty .m4a was produced). If it rejects, fix the WASAPI/pipe handshake before proceeding — this is the gate the spike exists for.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/recorder/pipes.rs glint/src-tauri/src/recorder/audio.rs glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs glint/src-tauri/Cargo.lock
git commit -m "feat(p8 r2): WASAPI capture + named-pipe helper + audio-chain spike"
```

---

### Task 3: Integrate audio into the segment lifecycle

Wire real recordings to capture audio: `recorder_start` accepts source booleans, each segment creates pipes + capture threads alongside ffmpeg, and pause/stop/cancel tear them down in the correct order.

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs`
- Modify: `glint/src-tauri/src/lib.rs` (none new; `recorder_start` signature changes are transparent to the macro)
- Modify: `glint/src/lib/recorder.ts` (pass audio booleans)

**Interfaces:**
- Consumes: `AudioConfig` (Task 1), `audio::start_capture` / `CaptureFormat` / `Source`, `pipes::{pipe_path, create_server}` (Task 2), `ffmpeg::AudioInput` (Task 1).
- Produces:
  - `Segment` gains `pub audio: Vec<AudioCapture>`.
  - `AudioCapture { pub stop: Arc<AtomicBool>, pub thread: JoinHandle<()>, pub pump: tokio::task::JoinHandle<()> }`
  - `ActiveRecording` gains `pub audio_cfg: AudioConfig` and `pub controls: AudioControls`.
  - `AudioControls { pub system_muted: Arc<AtomicBool>, pub mic_muted: Arc<AtomicBool> }` — `#[derive(Clone, Default)]`
  - `recorder_start(app, mode, x, y, w, h, system: Option<bool>, mic: Option<bool>)` — two new trailing params.

- [ ] **Step 1: Add the new structs + imports in `mod.rs`**

At the top, extend imports:

```rust
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
```

Add structs near `Segment`:

```rust
/// One source's live capture: the WASAPI thread + the tokio pump task feeding its
/// pipe, with a shared stop flag. Dropping/awaiting both ends the pipe → ffmpeg EOF.
pub struct AudioCapture {
    pub stop: Arc<AtomicBool>,
    pub thread: std::thread::JoinHandle<()>,
    pub pump: tokio::task::JoinHandle<()>,
}

/// Mute flags that persist across segments (a muted source stays muted after resume).
#[derive(Clone, Default)]
pub struct AudioControls {
    pub system_muted: Arc<AtomicBool>,
    pub mic_muted: Arc<AtomicBool>,
}
```

Add `pub audio: Vec<AudioCapture>` to `Segment` and `pub audio_cfg: AudioConfig, pub controls: AudioControls` to `ActiveRecording`.

- [ ] **Step 2: Replace `spawn_segment` with an async, audio-aware version**

```rust
/// Spawn one ffmpeg span writing to `path`, capturing the configured audio sources
/// into per-source named pipes that ffmpeg mixes + muxes. Async: it awaits each
/// pipe's connect after ffmpeg opens it.
async fn spawn_segment(
    app: &AppHandle,
    target: RecordTarget,
    fps: u32,
    path: &str,
    seg_index: usize,
    cfg: AudioConfig,
    controls: &AudioControls,
) -> Result<Segment, String> {
    use tokio::io::AsyncWriteExt;

    // Resolve sources → (tag, muted flag, started capture). A source that fails to
    // open is dropped with a toast; recording proceeds with whatever remains.
    struct Pending {
        tag: &'static str,
        input: ffmpeg::AudioInput,
        server: tokio::net::windows::named_pipe::NamedPipeServer,
        stop: Arc<AtomicBool>,
        rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
        thread: std::thread::JoinHandle<()>,
    }
    let mut pending: Vec<Pending> = Vec::new();

    let mut want: Vec<(&'static str, audio::Source, Arc<AtomicBool>)> = Vec::new();
    if cfg.system { want.push(("sys", audio::Source::System, controls.system_muted.clone())); }
    if cfg.mic { want.push(("mic", audio::Source::Mic, controls.mic_muted.clone())); }

    for (tag, source, muted) in want {
        let stop = Arc::new(AtomicBool::new(false));
        match audio::start_capture(source, muted, stop.clone()) {
            Ok((fmt, rx, thread)) => {
                let pp = pipes::pipe_path(tag, seg_index);
                match pipes::create_server(&pp) {
                    Ok(server) => pending.push(Pending {
                        tag,
                        input: ffmpeg::AudioInput { pipe_path: pp, sample_rate: fmt.sample_rate, channels: fmt.channels },
                        server, stop, rx, thread,
                    }),
                    Err(e) => {
                        log::warn!("{tag} pipe failed: {e}");
                        stop.store(true, Ordering::Relaxed);
                        let _ = thread.join();
                        let _ = app.emit("glint-toast", format!("{} audio unavailable", if tag == "mic" { "Microphone" } else { "System" }));
                    }
                }
            }
            Err(e) => {
                log::warn!("{tag} capture failed: {e}");
                let _ = app.emit("glint-toast", format!("{} audio unavailable", if tag == "mic" { "Microphone" } else { "System" }));
            }
        }
    }

    let inputs: Vec<ffmpeg::AudioInput> = pending.iter().map(|p| ffmpeg::AudioInput {
        pipe_path: p.input.pipe_path.clone(), sample_rate: p.input.sample_rate, channels: p.input.channels,
    }).collect();

    let args = ffmpeg::build_ffmpeg_args(&target, fps, path, &inputs);
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("sidecar resolve: {e}"))?;
    let (rx_ev, child) = sidecar.args(args).spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;

    // ffmpeg is now opening each pipe as a client; accept + start pumping.
    let mut audio_caps = Vec::new();
    for mut p in pending {
        if let Err(e) = p.server.connect().await {
            log::warn!("{} pipe connect failed: {e}", p.tag);
            p.stop.store(true, Ordering::Relaxed);
            let _ = p.thread.join();
            continue;
        }
        let mut server = p.server;
        let mut rx = p.rx;
        let pump = tokio::spawn(async move {
            while let Some(buf) = rx.recv().await {
                if server.write_all(&buf).await.is_err() { break; }
            }
            let _ = server.shutdown().await;
        });
        audio_caps.push(AudioCapture { stop: p.stop, thread: p.thread, pump });
    }

    Ok(Segment { child, rx: rx_ev, path: path.to_string(), audio: audio_caps })
}
```

- [ ] **Step 3: Tear down audio in `finish_segment`**

Replace `finish_segment` so it stops capture **after** ffmpeg exits:

```rust
async fn finish_segment(seg: Segment) {
    let Segment { mut child, mut rx, audio, .. } = seg;
    let _ = child.write(b"q\n");
    let exited = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(ev) = rx.recv().await {
            if matches!(ev, CommandEvent::Terminated(_)) { break; }
        }
    }).await.is_ok();
    if !exited {
        log::warn!("ffmpeg segment did not exit within 30s of 'q'; killing as a last resort");
        let _ = child.kill();
    }
    // ffmpeg done → stop capture threads, drain pumps.
    for cap in audio {
        cap.stop.store(true, Ordering::Relaxed);
        let _ = cap.thread.join();
        let _ = cap.pump.await;
    }
}
```

- [ ] **Step 4: Update `recorder_start` signature + segment-0 spawn + state**

Change the command signature to add `system: Option<bool>, mic: Option<bool>` after `h`. Before the countdown, resolve the config and controls:

```rust
    let audio_cfg = AudioConfig { system: system.unwrap_or(true), mic: mic.unwrap_or(false) };
    let controls = AudioControls::default();
```

Replace the segment-0 spawn with the async, audio-aware call and store the new fields:

```rust
    let seg0 = spawn_segment(&app, target, 30, &segment_path(&out_str, 0), 0, audio_cfg, &controls)
        .await
        .map_err(|e| { let _ = app.emit("glint-toast", "Couldn't start the recorder"); e })?;

    *app.state::<RecorderState>().0.lock().unwrap() = Some(ActiveRecording {
        target, fps: 30, out_path: out_str, width, height,
        started: Instant::now(), seg_index: 1, done: Vec::new(),
        current: Some(seg0), audio_cfg, controls,
    });
```

- [ ] **Step 5: Update `recorder_resume` to pass audio through**

In `recorder_resume`, the under-lock read must also clone `audio_cfg` + `controls`, and the spawn becomes async with them:

```rust
        match guard.as_ref() {
            Some(rec) if rec.current.is_none() => {
                Some((rec.target, rec.fps, rec.out_path.clone(), rec.seg_index, rec.audio_cfg, rec.controls.clone()))
            }
            _ => None,
        }
```

```rust
    let (target, fps, out_path, idx, cfg, controls) = info.ok_or("not paused")?;
    let path = segment_path(&out_path, idx);
    let seg = spawn_segment(&app, target, fps, &path, idx, cfg, &controls).await
        .map_err(|e| { let _ = app.emit("glint-toast", "Couldn't resume recording"); e })?;
```

- [ ] **Step 6: Tear down audio in `recorder_cancel`**

In the `cancel` body, after killing the running child, stop its captures:

```rust
        if let Some(Segment { mut child, path, audio, .. }) = current {
            let _ = child.write(b"q\n");
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let _ = child.kill();
            for cap in audio {
                cap.stop.store(Ordering::Relaxed.into(), Ordering::Relaxed); // see note
                let _ = cap.thread.join();
                let _ = cap.pump.await;
            }
            done.push(path);
        }
```

> Note: write `cap.stop.store(true, Ordering::Relaxed);` (the snippet above shows the intent; use `true`).

- [ ] **Step 7: Frontend passes audio booleans**

In `glint/src/lib/recorder.ts`, extend the start wrappers (Task 5 supplies real values; default here):

```ts
export const recorderStartFullscreen = (audio?: { system: boolean; mic: boolean }): Promise<void> =>
  invoke<void>("recorder_start", { mode: "fullscreen", system: audio?.system ?? true, mic: audio?.mic ?? false });
export const recorderStartRegion = (
  r: { x: number; y: number; w: number; h: number },
  audio?: { system: boolean; mic: boolean },
): Promise<void> =>
  invoke<void>("recorder_start", { mode: "region", x: r.x, y: r.y, w: r.w, h: r.h, system: audio?.system ?? true, mic: audio?.mic ?? false });
```

- [ ] **Step 8: Build + at-screen verify**

Run: `cargo build -p glint 2>&1 | tail -20` then `npm run build` (from `glint/`). Expected: both clean.
At-screen: record fullscreen with sound playing → stop → the saved MP4 has audible system audio, A/V in sync. Pause/resume mid-recording → audio resumes, paused gap excised.

- [ ] **Step 9: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs glint/src/lib/recorder.ts
git commit -m "feat(p8 r2): capture audio per segment (start/pause/resume/stop/cancel)"
```

---

### Task 4: Live mute (backend command + control-bar toggles)

**Files:**
- Modify: `glint/src-tauri/src/recorder/mod.rs` (`recorder_set_mute` + extend `RecorderStatusDto`)
- Modify: `glint/src-tauri/src/lib.rs` (register `recorder_set_mute`)
- Modify: `glint/src/lib/recorder.ts` (`recorderSetMute`, extend `RecorderStatus`)
- Modify: `glint/src/recorder/ControlBar.tsx` (mic/system mute toggles)
- Modify: `glint/src/recorder/recorder.css` (toggle styles)

**Interfaces:**
- Consumes: `ActiveRecording.controls` / `audio_cfg` (Task 3).
- Produces:
  - `recorder_set_mute(app, source: String, muted: bool) -> Result<(), String>` — `source` ∈ {"system","mic"}.
  - `RecorderStatusDto` gains `system: bool, mic: bool, system_muted: bool, mic_muted: bool`.
  - TS `recorderSetMute(source: "system" | "mic", muted: boolean)`.

- [ ] **Step 1: `recorder_set_mute` + extend status (mod.rs)**

```rust
/// Toggle a source's live mute. Muting writes silence into that source's pipe, so
/// the stream stays continuous and A/V-synced. No-op if not recording.
#[tauri::command]
pub fn recorder_set_mute(app: tauri::AppHandle, source: String, muted: bool) -> Result<(), String> {
    let state = app.state::<RecorderState>();
    let guard = state.0.lock().unwrap();
    let rec = guard.as_ref().ok_or("not recording")?;
    let flag = match source.as_str() {
        "system" => &rec.controls.system_muted,
        "mic" => &rec.controls.mic_muted,
        other => return Err(format!("unknown source: {other}")),
    };
    flag.store(muted, std::sync::atomic::Ordering::Relaxed);
    Ok(())
}
```

Extend `RecorderStatusDto`:

```rust
#[derive(Serialize)]
pub struct RecorderStatusDto {
    pub recording: bool,
    pub elapsed_secs: u64,
    pub system: bool,
    pub mic: bool,
    pub system_muted: bool,
    pub mic_muted: bool,
}
```

And in `recorder_status`, populate from the active recording:

```rust
    guard.as_ref().map(|r| RecorderStatusDto {
        recording: true,
        elapsed_secs: r.started.elapsed().as_secs(),
        system: r.audio_cfg.system,
        mic: r.audio_cfg.mic,
        system_muted: r.controls.system_muted.load(std::sync::atomic::Ordering::Relaxed),
        mic_muted: r.controls.mic_muted.load(std::sync::atomic::Ordering::Relaxed),
    })
```

Register `recorder::recorder_set_mute` in `lib.rs`.

- [ ] **Step 2: Frontend IPC (recorder.ts)**

```ts
export interface RecorderStatus {
  recording: boolean; elapsed_secs: number;
  system: boolean; mic: boolean; system_muted: boolean; mic_muted: boolean;
}
export const recorderSetMute = (source: "system" | "mic", muted: boolean): Promise<void> =>
  invoke<void>("recorder_set_mute", { source, muted });
```

- [ ] **Step 3: Control-bar mute toggles (ControlBar.tsx)**

On mount, read `recorderStatus()` to learn which sources are active + their mute state; render a small toggle per active source (mic / system) using lucide `Mic`/`MicOff` and `Volume2`/`VolumeX`. Clicking calls `recorderSetMute` and flips local state. Place the toggles between the timer and the pause button. (Sources inactive at start render nothing.)

```tsx
// inside ControlBar, after the existing useState hooks:
const [audio, setAudio] = useState<{ system: boolean; mic: boolean; sysMuted: boolean; micMuted: boolean } | null>(null);
useEffect(() => {
  recorderStatus().then((s) => {
    if (s) setAudio({ system: s.system, mic: s.mic, sysMuted: s.system_muted, micMuted: s.mic_muted });
  }).catch(() => {});
}, []);
const toggle = async (src: "system" | "mic", next: boolean) => {
  try { await recorderSetMute(src, next); } catch { return; }
  setAudio((a) => a && { ...a, ...(src === "system" ? { sysMuted: next } : { micMuted: next }) });
};
```

Render (only when active), e.g. for system:

```tsx
{audio?.system && (
  <button className={`rec-atog${audio.sysMuted ? " rec-atog--off" : ""}`}
    onClick={() => toggle("system", !audio.sysMuted)}
    title={audio.sysMuted ? "Unmute system audio" : "Mute system audio"}
    aria-label="Toggle system audio">
    {audio.sysMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
  </button>
)}
{audio?.mic && (
  <button className={`rec-atog${audio.micMuted ? " rec-atog--off" : ""}`}
    onClick={() => toggle("mic", !audio.micMuted)}
    title={audio.micMuted ? "Unmute microphone" : "Mute microphone"}
    aria-label="Toggle microphone">
    {audio.micMuted ? <MicOff size={13} /> : <Mic size={13} />}
  </button>
)}
```

Import `Mic, MicOff, Volume2, VolumeX` from `lucide-react`, and `recorderStatus, recorderSetMute` from `../lib/recorder`. Widen the bar window if needed (see `windows.rs build_control_bar` `inner_size` — bump from `216.0` to `280.0` and the matching `bar_w`).

- [ ] **Step 4: CSS (recorder.css)**

```css
.rec-atog { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: none; border-radius: 6px; background: rgba(255,255,255,0.14); color: #fff; cursor: pointer; }
.rec-atog:hover { background: rgba(255,255,255,0.24); }
.rec-atog--off { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }
```

- [ ] **Step 5: Build + at-screen verify**

Run: `cargo build -p glint` and `npm run build`. Expected: clean.
At-screen: start with system+mic on; mute mic mid-recording (talk) → that span is silent on mic but keeps system audio; unmute → returns. Verify the saved file matches.

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/recorder/mod.rs glint/src-tauri/src/lib.rs glint/src-tauri/src/recorder/windows.rs glint/src/lib/recorder.ts glint/src/recorder/ControlBar.tsx glint/src/recorder/recorder.css
git commit -m "feat(p8 r2): live mute toggles (system/mic) on the control bar"
```

---

### Task 5: Source selection (settings defaults + selector chips)

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (two bool fields + `apply_update` + tests)
- Modify: `glint/src/recorder/RegionSelect.tsx` (System/Mic chips, seeded from settings, passed to start)
- Modify: `glint/src/recorder/recorder.css` (chip styles)
- Modify: Settings UI view (add the two toggles next to existing booleans)

**Interfaces:**
- Consumes: `recorderStartFullscreen(audio)` / `recorderStartRegion(r, audio)` (Task 3), `useAppStore` settings.
- Produces: `Settings.record_system_audio: bool` (default true), `Settings.record_microphone: bool` (default false); `apply_update` keys `record_system_audio`, `record_microphone`.

- [ ] **Step 1: Failing tests for the settings fields (settings/mod.rs)**

```rust
#[test]
fn defaults_audio_system_on_mic_off() {
    let s = Settings::default();
    assert!(s.record_system_audio);
    assert!(!s.record_microphone);
}

#[test]
fn apply_update_sets_audio_bools() {
    let mut s = Settings::default();
    apply_update(&mut s, "record_microphone", serde_json::json!(true)).unwrap();
    assert!(s.record_microphone);
    apply_update(&mut s, "record_system_audio", serde_json::json!(false)).unwrap();
    assert!(!s.record_system_audio);
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -p glint --lib settings 2>&1 | tail -15`
Expected: FAIL (unknown field / unknown key).

- [ ] **Step 3: Add the fields + defaults + apply_update arms**

Add to `struct Settings`:

```rust
    pub record_system_audio: bool,
    pub record_microphone: bool,
```

Add to `Default`:

```rust
            record_system_audio: true,
            record_microphone: false,
```

Add to `apply_update`:

```rust
        "record_system_audio" => {
            s.record_system_audio = value.as_bool().ok_or("record_system_audio must be boolean")?;
        }
        "record_microphone" => {
            s.record_microphone = value.as_bool().ok_or("record_microphone must be boolean")?;
        }
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test -p glint --lib settings 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 5: Selector chips (RegionSelect.tsx)**

Add two toggle chips to the existing `.rec-sel-toolbar`, seeded from `useAppStore` settings (`record_system_audio` / `record_microphone`), holding local state. Pass the chosen `{ system, mic }` into both `recorderStartRegion(... , audio)` and `recorderStartFullscreen(audio)` calls (the existing `confirmRegion` / `confirmFullscreen`). Use lucide `Volume2`/`VolumeX` and `Mic`/`MicOff` for the chips. The chips toggle intent for THIS recording only (don't persist back unless trivial).

```tsx
const settings = useAppStore((s) => s.settings);
const [sys, setSys] = useState(true);
const [mic, setMic] = useState(false);
useEffect(() => {
  if (settings) { setSys(settings.record_system_audio ?? true); setMic(settings.record_microphone ?? false); }
}, [settings]);
// in confirmRegion: recorderStartRegion({ x, y, w, h }, { system: sys, mic }).catch(...)
// in confirmFullscreen: recorderStartFullscreen({ system: sys, mic }).catch(...)
```

Chips markup inside `.rec-sel-toolbar` (before the full-screen button), each `onPointerDown={(e) => e.stopPropagation()}` so they don't start a drag:

```tsx
<button className={`rec-sel-chip${sys ? "" : " rec-sel-chip--off"}`} onPointerDown={(e)=>e.stopPropagation()} onClick={() => setSys(v=>!v)} title="System audio">
  {sys ? <Volume2 size={14}/> : <VolumeX size={14}/>} System
</button>
<button className={`rec-sel-chip${mic ? "" : " rec-sel-chip--off"}`} onPointerDown={(e)=>e.stopPropagation()} onClick={() => setMic(v=>!v)} title="Microphone">
  {mic ? <Mic size={14}/> : <MicOff size={14}/>} Mic
</button>
```

- [ ] **Step 6: Chip CSS (recorder.css)**

```css
.rec-sel-chip { pointer-events: auto; display: inline-flex; align-items: center; gap: 5px; background: rgba(20,22,30,0.7); color: #fff; border: 1px solid rgba(255,255,255,0.16); padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; }
.rec-sel-chip--off { color: rgba(255,255,255,0.45); border-color: rgba(255,255,255,0.08); }
```

- [ ] **Step 7: Settings UI toggles**

Find the Settings view that renders the existing booleans (`auto_save`, `open_in_editor`, `explorer_menu_enabled`) — search `open_in_editor` under `glint/src`. Add two rows, "Record system audio" and "Record microphone", wired to the same `settings_set` path used by the others, keys `record_system_audio` / `record_microphone`. Mirror the existing toggle component exactly.

- [ ] **Step 8: Build + verify**

Run: `cargo test -p glint --lib settings`, `npm run build`, `npm run test`. Expected: all pass.
At-screen: toggle mic on in the selector → record → mic is captured; default (no mic) → only system. Settings defaults reflected in the chips.

- [ ] **Step 9: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src/recorder/RegionSelect.tsx glint/src/recorder/recorder.css glint/src/<settings-view>
git commit -m "feat(p8 r2): audio source selection (settings defaults + selector chips)"
```

---

### Task 6: Acceptance doc + roadmap update

**Files:**
- Create: `docs/superpowers/PHASE-8-RECORDER-R2-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md` (move R2 from Planned → Shipped)

- [ ] **Step 1: Run the full green gate**

From `glint/src-tauri`: `cargo build`, `cargo test`. From `glint/`: `npm run build`, `npm run test`. Record the counts.

- [ ] **Step 2: Write the acceptance doc**

Mirror `PHASE-8-RECORDER-R1-ACCEPTANCE.md`: green-gate counts, the at-screen checklist (system-only, mic-only, both, live-mute each, pause/resume with audio, 60s sync, absent-mic fallback), the WASAPI/named-pipe prerequisite note, and any deferred gaps (device pickers, volume sliders).

- [ ] **Step 3: Update the roadmap**

Move "Phase 8 R2 — Recording audio" into the Shipped section with a one-line summary (system + mic via WASAPI loopback → named pipes → ffmpeg amix/AAC; per-recording source chips; live control-bar mute).

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-8-RECORDER-R2-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p8 r2): audio acceptance checklist + roadmap update"
```

---

## Self-Review

**Spec coverage:**
- System + mic capture via WASAPI loopback/capture → Tasks 2, 3. ✓
- Named pipes → ffmpeg amix/AAC mux → Tasks 1, 2, 3. ✓
- Per-segment lifecycle reuse (pause/resume/concat) → Task 3. ✓
- Settings defaults (system on, mic off) → Task 5. ✓
- Per-recording selection (selector chips) → Task 5. ✓
- Live mute via silence → Tasks 3 (silence-on-mute in capture) + 4 (command/UI). ✓
- Privacy (source only opened if enabled at start) → Task 3 (`want` built from `cfg`). ✓
- Error handling (skip failed source + toast; all-fail → silent) → Task 3 spawn_segment. ✓
- Spike-first de-risk → Task 2. ✓
- Unit tests on pure args/source logic → Tasks 1, 5. ✓
- Acceptance + roadmap → Task 6. ✓

**Placeholder scan:** WASAPI inner calls in Task 2 are explicitly spike-resolved against the crate (external-hardware integration), with the cross-task contract (signature + silence-on-mute + stop semantics) fully specified. Settings-view file path is a search target (Task 5 Step 7) because the exact view file isn't yet known — resolved by grep, not left vague. No other placeholders.

**Type consistency:** `AudioConfig{system,mic}`, `AudioInput{pipe_path,sample_rate,channels}`, `CaptureFormat{sample_rate,channels}`, `AudioControls{system_muted,mic_muted}`, `AudioCapture{stop,thread,pump}`, `Source{System,Mic}`, and `start_capture` / `build_ffmpeg_args` / `recorder_set_mute` / `recorder_start` signatures are used identically across Tasks 1–5. `pipe_path(tag,seg)` and `create_server(path)` consistent between Tasks 2 and 3.
