//! Screen recorder (R1: silent video). ISOLATED — owns the bundled ffmpeg
//! sidecar; the screenshot/library/editor path imports nothing from here. The
//! only outbound coupling is on stop: write the MP4 + insert one Library row.

pub mod audio;
pub mod ffmpeg;
pub mod pipes;
pub mod thumb;
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// One running ffmpeg span — a contiguous stretch of recording between pauses.
/// Holds the child (to send `q` on stdin) and its event receiver (to wait for a
/// clean exit + finished moov atom rather than guessing with a fixed delay).
pub struct Segment {
    pub child: CommandChild,
    pub rx: tauri::async_runtime::Receiver<CommandEvent>,
    pub path: String,
    /// Live audio captures feeding this span's ffmpeg via named pipes.
    pub audio: Vec<AudioCapture>,
}

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

/// One in-flight recording. Pause/resume splits it into segments: pausing stops
/// the running span, resuming spawns the next, and stop concatenates them — so
/// the paused time is genuinely cut from the result (CleanShot-style), not frozen.
pub struct ActiveRecording {
    pub target: RecordTarget,
    pub fps: u32,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub started: Instant,
    /// Index of the NEXT segment file to spawn (segment 0 starts at recorder_start).
    pub seg_index: usize,
    /// Completed segment file paths, in playback order.
    pub done: Vec<String>,
    /// The currently-recording span. `None` while paused.
    pub current: Option<Segment>,
    /// Audio sources resolved once at start (a source absent here is never opened).
    pub audio_cfg: AudioConfig,
    /// Mute flags shared across all segments of this recording.
    pub controls: AudioControls,
}

/// `{out_dir}/{stem}.part{idx}.mp4` — per-segment temp file beside the final output.
fn segment_path(out_path: &str, idx: usize) -> String {
    let p = std::path::Path::new(out_path);
    let parent = p.parent().unwrap_or_else(|| std::path::Path::new("."));
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Glint".into());
    parent
        .join(format!("{stem}.part{idx}.mp4"))
        .to_string_lossy()
        .to_string()
}

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

    // `want_audio` is the recording's intent (system or mic enabled), not how many
    // sources actually connected this segment — so a segment whose sources all failed
    // still gets a silent aac track and stays concat-copy compatible with audio segments.
    let args = ffmpeg::build_ffmpeg_args(&target, fps, path, &inputs, cfg.system || cfg.mic);
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("sidecar resolve: {e}"))?;
    let (rx_ev, child) = sidecar.args(args).spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;

    // ffmpeg is now opening each pipe as a client; accept + start pumping. Bound
    // the accept: if ffmpeg never opens a pipe (bad args / sidecar died), an
    // unbounded `connect()` would wedge recorder_start/recorder_resume forever and
    // the capture channel would grow without limit. On timeout or error, stop the
    // capture thread and toast — recording proceeds with whatever pipes connected.
    let mut audio_caps = Vec::new();
    for p in pending {
        match tokio::time::timeout(std::time::Duration::from_secs(3), p.server.connect()).await {
            Ok(Ok(())) => {
                let mut server = p.server;
                let mut rx = p.rx;
                let pump = tokio::spawn(async move {
                    while let Some(buf) = rx.recv().await {
                        if server.write_all(&buf).await.is_err() { break; }
                    }
                    let _ = server.shutdown().await;
                });
                audio_caps.push(AudioCapture { stop: p.stop, thread: p.thread, pump });
                continue;
            }
            Ok(Err(e)) => log::warn!("{} pipe connect failed: {e}", p.tag),
            Err(_) => log::warn!("{} pipe never connected (ffmpeg open timed out)", p.tag),
        }
        p.stop.store(true, Ordering::Relaxed);
        let _ = p.thread.join();
        let _ = app.emit("glint-toast", format!("{} audio unavailable", if p.tag == "mic" { "Microphone" } else { "System" }));
    }

    Ok(Segment { child, rx: rx_ev, path: path.to_string(), audio: audio_caps })
}

/// Stop one span gracefully: `q` on stdin (trailing newline so the byte reaches
/// ffmpeg's stdin reader on Windows), then WAIT for ffmpeg to actually exit — a
/// long span's `+faststart` finalize can take a while, and killing mid-finalize
/// corrupts the MP4. Kill only as a last resort 30s after `q`.
async fn finish_segment(seg: Segment) {
    let Segment { mut child, mut rx, audio, .. } = seg;
    let _ = child.write(b"q\n");
    let exited = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        while let Some(ev) = rx.recv().await {
            if matches!(ev, CommandEvent::Terminated(_)) {
                break;
            }
        }
    })
    .await
    .is_ok();
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

/// Assemble the recorded segments into the final `out_path`. One real span → a
/// plain rename (the no-pause common case, ~free). Multiple → concat-copy (no
/// re-encode). Drops empty/failed spans. Cleans up all segment files. Returns
/// whether `out_path` ended up present.
async fn assemble_segments(app: &AppHandle, segs: &[String], out_path: &str) -> bool {
    let real: Vec<&String> = segs
        .iter()
        .filter(|s| std::fs::metadata(s).map(|m| m.len() >= 1024).unwrap_or(false))
        .collect();
    let ok = match real.as_slice() {
        [] => false,
        [only] => std::fs::rename(only, out_path).is_ok(),
        many => concat_segments(app, many, out_path).await,
    };
    for s in segs {
        let _ = std::fs::remove_file(s);
    }
    ok && std::path::Path::new(out_path).exists()
}

/// Concat same-params H.264 spans with the concat demuxer + stream copy (no
/// re-encode). Forward-slash, single-quoted paths in the list file keep the
/// demuxer happy on Windows; our date-based names contain no quotes.
async fn concat_segments(app: &AppHandle, segs: &[&String], out_path: &str) -> bool {
    let list_path = format!("{out_path}.concat.txt");
    let mut content = String::new();
    for s in segs {
        content.push_str(&format!("file '{}'\n", s.replace('\\', "/")));
    }
    if std::fs::write(&list_path, &content).is_err() {
        return false;
    }
    let sidecar = match app.shell().sidecar("ffmpeg") {
        Ok(s) => s,
        Err(_) => {
            let _ = std::fs::remove_file(&list_path);
            return false;
        }
    };
    let out = sidecar
        .args([
            "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
            "-i", list_path.as_str(), "-c", "copy", "-movflags", "+faststart", out_path,
        ])
        .output()
        .await;
    let _ = std::fs::remove_file(&list_path);
    matches!(out, Ok(o) if o.status.success()) && std::path::Path::new(out_path).exists()
}

#[derive(Default)]
pub struct RecorderState(pub Mutex<Option<ActiveRecording>>);

#[derive(Serialize)]
pub struct RecorderStatusDto {
    pub recording: bool,
    pub elapsed_secs: u64,
    pub system: bool,
    pub mic: bool,
    pub system_muted: bool,
    pub mic_muted: bool,
}

/// What to record. Region coords/size are PHYSICAL pixels on the primary monitor.
#[derive(Clone, Copy, Debug)]
pub enum RecordTarget {
    Fullscreen,
    Region { x: i32, y: i32, w: u32, h: u32 },
}

/// Which audio sources a recording captures. Resolved once at start from the
/// frontend's request; a source absent here is never opened (mic privacy).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AudioConfig {
    pub system: bool,
    pub mic: bool,
}

/// Round a region rect for recording: even w/h (yuv420p requires it); reject if
/// the result is too small to be a real selection (< 16px either side).
pub fn normalize_region(x: i32, y: i32, w: u32, h: u32) -> Option<(i32, i32, u32, u32)> {
    let w = ffmpeg::even(w);
    let h = ffmpeg::even(h);
    if w < 16 || h < 16 {
        return None;
    }
    Some((x, y, w, h))
}

/// `Glint 2026-06-28 at 14.30.05.mp4` — dots in the time so it's a valid filename.
pub fn recording_filename(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("Glint %Y-%m-%d at %H.%M.%S.mp4").to_string()
}

/// Spike/health-check: spawn the bundled ffmpeg sidecar and return its version
/// banner's first line. Confirms bundling + spawn + permissions before we build
/// the recorder on top. Runs off the main thread.
#[tauri::command(async)]
pub async fn recorder_ffmpeg_check(app: AppHandle) -> Result<String, String> {
    let out = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("sidecar resolve: {e}"))?
        .args(["-version"])
        .output()
        .await
        .map_err(|e| format!("spawn: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().unwrap_or("ffmpeg (no banner)").to_string())
}

/// Spike/health-check for the audio chain: capture ~1.5s of SYSTEM audio via
/// WASAPI loopback → named pipe → ffmpeg → temp .m4a, and return the byte size.
/// Run once at-screen (with sound playing) to confirm the mechanism before the
/// recorder depends on it. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_audio_check(app: tauri::AppHandle) -> Result<u64, String> {
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

    // Bound the wait: if ffmpeg never opens the pipe (bad args / sidecar died),
    // connect() would otherwise await a client forever and the unbounded capture
    // channel would grow without limit. Stop the capture thread on that path.
    tokio::time::timeout(std::time::Duration::from_secs(3), server.connect())
        .await
        .map_err(|_| {
            stop.store(true, std::sync::atomic::Ordering::Relaxed);
            "ffmpeg never connected to the audio pipe".to_string()
        })?
        .map_err(|e| format!("connect: {e}"))?;
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

/// Start recording. `mode` is "fullscreen" or "region"; region passes x/y/w/h
/// (physical px). Spawns ffmpeg (capture+encode) and stores the child. Off the
/// main thread so the spawn never blocks the event loop.
#[tauri::command(async)]
pub async fn recorder_start(
    app: tauri::AppHandle,
    mode: String,
    x: Option<i32>,
    y: Option<i32>,
    w: Option<u32>,
    h: Option<u32>,
    system: Option<bool>,
    mic: Option<bool>,
) -> Result<(), String> {
    // Already recording? Ignore (single recording in R1).
    if app.state::<RecorderState>().0.lock().unwrap().is_some() {
        return Err("already recording".into());
    }

    // The selector (if this start came from it) closes itself, so the frontend's
    // IPC survives (closing destroys its JS context) and a full-screen capture
    // never includes the transparent overlay. No-op for a tray/hotkey fullscreen.
    windows::close_region_selector(&app);

    let target = match mode.as_str() {
        "fullscreen" => RecordTarget::Fullscreen,
        "region" => {
            let (x, y, w, h) = (x.unwrap_or(0), y.unwrap_or(0), w.unwrap_or(0), h.unwrap_or(0));
            // The selector window is already closed by the time we get here, so a
            // toast (not the gone window) is the only way the user sees this.
            let (x, y, w, h) = normalize_region(x, y, w, h).ok_or_else(|| {
                let _ = app.emit("glint-toast", "Selection too small to record");
                "selection too small".to_string()
            })?;
            RecordTarget::Region { x, y, w, h }
        }
        other => return Err(format!("unknown mode: {other}")),
    };

    // Output path in Videos\Glint. Toast on failure — callers spawn-and-forget the
    // Result, so a bare Err would leave the user with nothing happening.
    let videos = app.path().video_dir().map_err(|e| {
        let _ = app.emit("glint-toast", "Couldn't start the recorder");
        e.to_string()
    })?;
    let dir = videos.join("Glint");
    std::fs::create_dir_all(&dir).map_err(|e| {
        let _ = app.emit("glint-toast", "Couldn't start the recorder");
        e.to_string()
    })?;
    let out = dir.join(recording_filename(chrono::Local::now()));
    let out_str = out.to_string_lossy().to_string();

    let (width, height) = match target {
        // Region dims are known + stored on the Library row. Fullscreen records at
        // native resolution; the exact dims aren't known here, so they stay 0/None.
        RecordTarget::Region { w, h, .. } => (w, h),
        RecordTarget::Fullscreen => (0, 0),
    };

    // 3-2-1 countdown, then Rust closes it BEFORE capture starts so the digit can
    // never bleed into the first recorded frames (and a webview that failed to
    // self-close isn't left orphaned on screen).
    let _ = windows::build_countdown(&app);
    tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    windows::close_countdown(&app);

    let audio_cfg = AudioConfig { system: system.unwrap_or(true), mic: mic.unwrap_or(false) };
    let controls = AudioControls::default();

    // Segment 0. Pause/resume appends further segments; stop concatenates them.
    let seg0 = spawn_segment(&app, target, 30, &segment_path(&out_str, 0), 0, audio_cfg, &controls)
        .await
        .map_err(|e| {
            let _ = app.emit("glint-toast", "Couldn't start the recorder");
            e
        })?;

    *app.state::<RecorderState>().0.lock().unwrap() = Some(ActiveRecording {
        target,
        fps: 30,
        out_path: out_str,
        width,
        height,
        started: Instant::now(),
        seg_index: 1,
        done: Vec::new(),
        current: Some(seg0),
        audio_cfg,
        controls,
    });
    let _ = windows::build_control_bar(&app);
    let _ = app.emit("recorder-started", ());
    Ok(())
}

/// Pause: stop the running span (a clean, self-contained MP4) and keep it. The
/// timer in the bar stops; resume spawns the next span, and stop stitches them —
/// so the paused interval is excised from the final video.
#[tauri::command(async)]
pub async fn recorder_pause(app: tauri::AppHandle) -> Result<(), String> {
    // Take the running span out under the lock; finish it without holding the lock.
    let seg = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        match guard.as_mut() {
            Some(rec) if rec.current.is_some() => {
                let seg = rec.current.take().unwrap();
                rec.done.push(seg.path.clone());
                Some(seg)
            }
            _ => None,
        }
    };
    let seg = seg.ok_or("not recording, or already paused")?;
    finish_segment(seg).await;
    let _ = app.emit("recorder-paused", ());
    Ok(())
}

/// Resume: spawn the next span. Inverse of pause.
#[tauri::command(async)]
pub async fn recorder_resume(app: tauri::AppHandle) -> Result<(), String> {
    // Read what we need under the lock; spawn outside it (spawn can block briefly).
    let info = {
        let state = app.state::<RecorderState>();
        let guard = state.0.lock().unwrap();
        match guard.as_ref() {
            Some(rec) if rec.current.is_none() => {
                Some((rec.target, rec.fps, rec.out_path.clone(), rec.seg_index, rec.audio_cfg, rec.controls.clone()))
            }
            _ => None,
        }
    };
    let (target, fps, out_path, idx, cfg, controls) = info.ok_or("not paused")?;
    let path = segment_path(&out_path, idx);
    let seg = spawn_segment(&app, target, fps, &path, idx, cfg, &controls).await
        .map_err(|e| {
            let _ = app.emit("glint-toast", "Couldn't resume recording");
            e
        })?;

    // Store it back. If the recording was stopped/canceled meanwhile (single-user,
    // unlikely), don't leak the orphan span — finish it and drop its file.
    let mut seg_opt = Some(seg);
    {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        if let Some(rec) = guard.as_mut() {
            rec.current = seg_opt.take();
            rec.seg_index += 1;
        }
    }
    if let Some(orphan) = seg_opt {
        finish_segment(orphan).await;
        let _ = std::fs::remove_file(&path);
        return Err("recording ended before resume".into());
    }
    let _ = app.emit("recorder-resumed", ());
    Ok(())
}

/// Stop + finalize: send `q` to ffmpeg (clean MP4), wait briefly, extract a
/// thumbnail, insert the Library row, emit capture-saved. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_stop(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    windows::close_control_bar(&app);
    let rec = rec.ok_or("not recording")?;
    let ActiveRecording { out_path, width, height, mut done, current, .. } = rec;

    // Finish the running span (None if we stopped while paused), then stitch all
    // recorded spans into the final file. Each span exits cleanly (q + wait) so
    // its moov atom is written before the concat/rename.
    if let Some(seg) = current {
        let p = seg.path.clone();
        finish_segment(seg).await;
        done.push(p);
    }
    if !assemble_segments(&app, &done, &out_path).await {
        let _ = app.emit("glint-toast", "Recording failed to save");
        return Err("no output file".into());
    }
    let bytes = std::fs::metadata(&out_path).map(|m| m.len() as i64).unwrap_or(0);
    if bytes < 1024 {
        let _ = std::fs::remove_file(&out_path);
        let _ = app.emit("glint-toast", "Recording too short");
        return Ok(());
    }

    let thumb_path = thumb::extract_thumb(&app, &out_path).await;
    let row = crate::db::NewCapture {
        kind: "recording".into(),
        path: out_path.clone(),
        thumb_path,
        width: (width > 0).then_some(width as i64),
        height: (height > 0).then_some(height as i64),
        bytes: Some(bytes),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("recording insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    let _ = app.emit("recorder-stopped", ());
    let _ = app.emit("glint-toast", "Recording saved");
    Ok(())
}

/// Discard an in-flight recording: stop ffmpeg and delete the partial file.
#[tauri::command(async)]
pub async fn recorder_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    windows::close_control_bar(&app);
    windows::close_countdown(&app); // in case cancel races the countdown
    if let Some(ActiveRecording { mut done, current, out_path, .. }) = rec {
        // Discarding everything, so finalization doesn't matter — quit the running
        // span fast, then delete every segment file (and any assembled output).
        if let Some(Segment { mut child, path, audio, .. }) = current {
            let _ = child.write(b"q\n");
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let _ = child.kill();
            for cap in audio {
                cap.stop.store(true, Ordering::Relaxed);
                let _ = cap.thread.join();
                let _ = cap.pump.await;
            }
            done.push(path);
        }
        for s in &done {
            let _ = std::fs::remove_file(s);
        }
        let _ = std::fs::remove_file(&out_path);
    }
    let _ = app.emit("recorder-stopped", ());
    Ok(())
}

#[tauri::command(async)]
pub async fn recorder_open_region_selector(app: tauri::AppHandle) -> Result<(), String> {
    windows::build_region_selector(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn recorder_status(app: tauri::AppHandle) -> Option<RecorderStatusDto> {
    let state = app.state::<RecorderState>();
    let guard = state.0.lock().unwrap();
    guard.as_ref().map(|r| RecorderStatusDto {
        recording: true,
        elapsed_secs: r.started.elapsed().as_secs(),
        system: r.audio_cfg.system,
        mic: r.audio_cfg.mic,
        system_muted: r.controls.system_muted.load(std::sync::atomic::Ordering::Relaxed),
        mic_muted: r.controls.mic_muted.load(std::sync::atomic::Ordering::Relaxed),
    })
}

/// Toggle a source's live mute. Muting writes silence into that source's pipe, so
/// the stream stays continuous and A/V-synced. No-op-erroring if not recording.
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
