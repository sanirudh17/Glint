//! Screen recorder (R1: silent video). ISOLATED — owns the bundled ffmpeg
//! sidecar; the screenshot/library/editor path imports nothing from here. The
//! only outbound coupling is on stop: write the MP4 + insert one Library row.

pub mod audio;
pub mod cam;
pub mod ffmpeg;
pub mod fx;
pub mod pipes;
pub mod thumb;
pub mod trim;
pub mod windows;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Cached, session-wide result of the ddagrab support probe.
static DDAGRAB_OK: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// Decide the capture engine once per session. Runs ffmpeg with a ddagrab source
/// producing a single frame to the null muxer; if that exits 0, DDA works on this
/// machine/session (GPU present, not an RDP/headless surface) → use ddagrab (true 60
/// fps). Any failure/timeout → gdigrab (the proven GDI path). Cached in a process-wide
/// OnceLock so only the first recording of a session pays the ~1–2 s probe. (A race is
/// impossible — recorder_start guards a single recording — so a plain get/set is safe.)
async fn probe_capture_engine(app: &AppHandle) -> ffmpeg::CaptureEngine {
    if let Some(&ok) = DDAGRAB_OK.get() {
        return if ok { ffmpeg::CaptureEngine::Ddagrab } else { ffmpeg::CaptureEngine::Gdigrab };
    }
    let ok = match app.shell().sidecar("ffmpeg") {
        Ok(cmd) => {
            let args = [
                "-nostats", "-loglevel", "error",
                "-init_hw_device", "d3d11va",
                "-filter_complex", "ddagrab=output_idx=0:framerate=30,hwdownload,format=bgra",
                "-frames:v", "1", "-f", "null", "-",
            ];
            match tokio::time::timeout(
                std::time::Duration::from_secs(4),
                cmd.args(args).output(),
            )
            .await
            {
                Ok(Ok(out)) => out.status.success(),
                _ => false, // spawn error, non-zero exit, or timeout → fall back
            }
        }
        Err(_) => false,
    };
    let _ = DDAGRAB_OK.set(ok);
    log::info!("capture engine probe: ddagrab_ok={ok}");
    if ok { ffmpeg::CaptureEngine::Ddagrab } else { ffmpeg::CaptureEngine::Gdigrab }
}

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
    /// Which source this is ("sys" | "mic") — drives the control bar's toggles.
    pub tag: &'static str,
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

impl AudioControls {
    /// Initial mute state — a source that was off in the selector starts muted so it
    /// can be unmuted live (both sources are opened when a recording has any audio).
    fn new(system_muted: bool, mic_muted: bool) -> Self {
        Self {
            system_muted: Arc::new(AtomicBool::new(system_muted)),
            mic_muted: Arc::new(AtomicBool::new(mic_muted)),
        }
    }
}

/// One in-flight recording. Pause/resume splits it into segments: pausing stops
/// the running span, resuming spawns the next, and stop concatenates them — so
/// the paused time is genuinely cut from the result (CleanShot-style), not frozen.
pub struct ActiveRecording {
    pub target: RecordTarget,
    pub fps: u32,
    /// Capture engine chosen once at start (ddagrab or gdigrab). Reused for every
    /// pause/resume segment so all segments share identical output stream params
    /// (the concat `-c copy` invariant).
    pub engine: ffmpeg::CaptureEngine,
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
    /// What the user selected at start (drives initial mute state).
    pub audio_cfg: AudioConfig,
    /// Whether each source actually opened — drives which toggles the control bar
    /// shows. Both open whenever the recording has any audio (so either can be
    /// unmuted live); a source whose device is missing is the only one omitted.
    pub sys_avail: bool,
    pub mic_avail: bool,
    /// Mute flags shared across all segments of this recording.
    pub controls: AudioControls,
    /// Whether the webcam bubble is currently open (sibling window — not encoded
    /// by ffmpeg, gdigrab records it as part of the screen).
    pub webcam_on: bool,
    /// Movable mode: the bubble is capture-excluded and the camera is recorded to its
    /// own `.cam.webm` track for post-hoc compositing.
    pub webcam_movable: bool,
    /// Sibling webcam-track path while a movable recording is in flight (`None` otherwise).
    pub cam_path: Option<String>,
    /// Active recording FX (click/keystroke/cursor). The overlay + hooks live here.
    pub fx_cfg: fx::FxConfig,
    pub fx: Option<fx::FxSession>,
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
// Retained: this is the ffmpeg-span constructor; every arg is a genuine capture
// parameter (target, fps, path, index, config, controls, resume-flag). Grouping
// them into a struct would only relocate the same fields.
#[allow(clippy::too_many_arguments)]
async fn spawn_segment(
    app: &AppHandle,
    engine: ffmpeg::CaptureEngine,
    target: RecordTarget,
    fps: u32,
    path: &str,
    seg_index: usize,
    cfg: AudioConfig,
    controls: &AudioControls,
    draw_mouse: bool,
) -> Result<Segment, String> {
    use tokio::io::AsyncWriteExt;

    // Resolve sources → (tag, muted flag, started capture). A source that fails to
    // open is dropped with a toast; recording proceeds with whatever remains.
    struct Pending {
        tag: &'static str,
        /// Was this source ON in the selector? Only enabled-then-failed sources
        /// toast — a source we open just to allow live-unmute shouldn't nag if its
        /// device is missing.
        user_enabled: bool,
        input: ffmpeg::AudioInput,
        server: tokio::net::windows::named_pipe::NamedPipeServer,
        stop: Arc<AtomicBool>,
        rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
        thread: std::thread::JoinHandle<()>,
    }
    let mut pending: Vec<Pending> = Vec::new();

    // Open BOTH sources whenever the recording has any audio, so either can be
    // muted/unmuted live from the control bar. The one that was off in the selector
    // starts muted (writes silence — no content leaks); the user can unmute it
    // mid-recording. (Opening the mic to allow this lights the OS mic indicator.)
    let mut want: Vec<(&'static str, audio::Source, Arc<AtomicBool>, bool)> = Vec::new();
    if cfg.system || cfg.mic {
        want.push(("sys", audio::Source::System, controls.system_muted.clone(), cfg.system));
        want.push(("mic", audio::Source::Mic, controls.mic_muted.clone(), cfg.mic));
    }

    for (tag, source, muted, user_enabled) in want {
        let label = if tag == "mic" { "Microphone" } else { "System" };
        let stop = Arc::new(AtomicBool::new(false));
        match audio::start_capture(source, muted, stop.clone()) {
            Ok((fmt, rx, thread)) => {
                log::info!("{tag} capture negotiated {}Hz {}ch", fmt.sample_rate, fmt.channels);
                let pp = pipes::pipe_path(tag, seg_index);
                match pipes::create_server(&pp) {
                    Ok(server) => pending.push(Pending {
                        tag, user_enabled,
                        input: ffmpeg::AudioInput { pipe_path: pp, sample_rate: fmt.sample_rate, channels: fmt.channels, is_mic: tag == "mic" },
                        server, stop, rx, thread,
                    }),
                    Err(e) => {
                        log::warn!("{tag} pipe failed: {e}");
                        stop.store(true, Ordering::Relaxed);
                        let _ = thread.join();
                        if user_enabled { let _ = app.emit("glint-toast", format!("{label} audio unavailable")); }
                    }
                }
            }
            Err(e) => {
                log::warn!("{tag} capture failed: {e}");
                if user_enabled { let _ = app.emit("glint-toast", format!("{label} audio unavailable")); }
            }
        }
    }

    let inputs: Vec<ffmpeg::AudioInput> = pending.iter().map(|p| ffmpeg::AudioInput {
        pipe_path: p.input.pipe_path.clone(), sample_rate: p.input.sample_rate, channels: p.input.channels, is_mic: p.input.is_mic,
    }).collect();

    // `want_audio` is the recording's intent (system or mic enabled), not how many
    // sources actually connected this segment — so a segment whose sources all failed
    // still gets a silent aac track and stays concat-copy compatible with audio segments.
    let args = ffmpeg::build_ffmpeg_args(engine, &target, fps, path, &inputs, cfg.system || cfg.mic, draw_mouse);
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
                    // Drop the pre-roll: the capture thread starts streaming the moment
                    // the source opens, but ffmpeg (a polling pipeline) only pulls its
                    // first frame from any input once ALL inputs are open — so the audio
                    // buffered before this pipe connected would be prepended to the
                    // stream and shove every bit of audio behind the video. Discarding
                    // it lines audio's first sample up with ffmpeg's first video frame;
                    // `aresample=async=1` then absorbs any residual drift.
                    while rx.try_recv().is_ok() {}
                    while let Some(buf) = rx.recv().await {
                        if server.write_all(&buf).await.is_err() { break; }
                    }
                    let _ = server.shutdown().await;
                });
                audio_caps.push(AudioCapture { tag: p.tag, stop: p.stop, thread: p.thread, pump });
                continue;
            }
            Ok(Err(e)) => log::warn!("{} pipe connect failed: {e}", p.tag),
            Err(_) => log::warn!("{} pipe never connected (ffmpeg open timed out)", p.tag),
        }
        p.stop.store(true, Ordering::Relaxed);
        let _ = p.thread.join();
        if p.user_enabled {
            let _ = app.emit("glint-toast", format!("{} audio unavailable", if p.tag == "mic" { "Microphone" } else { "System" }));
        }
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

/// `.0` is the active recording; `.1` is a start reservation held across the
/// countdown + ffmpeg spawn. The active slot isn't filled until ffmpeg is up, so
/// without the reservation a second trigger during the countdown would pass the
/// `is_some()` guard and spawn a parallel ffmpeg (same-second filename collision +
/// a leaked span).
#[derive(Default)]
pub struct RecorderState(pub Mutex<Option<ActiveRecording>>, pub AtomicBool);

/// The just-finished recording, surfaced by the post-recording HUD (id for the
/// Library actions, path for drag-out, thumb for the preview).
pub struct LastRecording {
    pub id: i64,
    pub path: String,
    pub thumb_path: Option<String>,
}

#[derive(Default)]
pub struct RecorderHud(pub Mutex<Option<LastRecording>>);

/// The recording the trim window is editing. Set by `recorder_open_trim` before the
/// window builds; the window reads it back via `recorder_trim_target`.
#[derive(Clone)]
pub struct TrimTarget { pub id: i64, pub path: String }

#[derive(Default)]
pub struct RecorderTrimState(pub Mutex<Option<TrimTarget>>);

#[derive(Serialize)]
pub struct TrimTargetDto { pub id: i64, pub path: String }

#[derive(Serialize)]
pub struct RecHudDataDto {
    pub id: i64,
    pub path: String,
    pub thumb_data_url: Option<String>,
}

/// Data for the post-recording HUD: the saved recording's id/path + its thumbnail
/// as a data URL. Recorder-owned (reads only recorder state + the thumb file).
#[tauri::command]
pub fn rec_hud_data(app: tauri::AppHandle) -> Option<RecHudDataDto> {
    use base64::Engine;
    let state = app.state::<RecorderHud>();
    let guard = state.0.lock().unwrap();
    let last = guard.as_ref()?;
    let thumb_data_url = last.thumb_path.as_ref().and_then(|p| {
        let bytes = std::fs::read(p).ok()?;
        Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    });
    Some(RecHudDataDto { id: last.id, path: last.path.clone(), thumb_data_url })
}

/// Dismiss the post-recording HUD and drop the recording it referenced (so a
/// stale path/id doesn't linger past the card).
#[tauri::command]
pub fn rec_hud_dismiss(app: tauri::AppHandle) {
    windows::close_rec_hud(&app);
    *app.state::<RecorderHud>().0.lock().unwrap() = None;
}

#[derive(Serialize)]
pub struct RecorderStatusDto {
    pub recording: bool,
    pub elapsed_secs: u64,
    pub system: bool,
    pub mic: bool,
    pub system_muted: bool,
    pub mic_muted: bool,
    pub webcam: bool,
    pub click_viz: bool,
    pub keystrokes: bool,
    pub spotlight: bool,
    pub cursor_hide: bool,
    pub cursor_size: String,
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
            if let Ok(Some(buf)) =
                tokio::time::timeout(std::time::Duration::from_millis(300), rx.recv()).await
            {
                let _ = server.write_all(&buf).await;
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

/// Block until the webcam bubble reports its camera is live (`rec-cam-ready`, fired
/// after getUserMedia resolves — i.e. the user pressed Allow) or failed/denied
/// (`rec-cam-failed`), or 20s elapse. Called before the countdown so the WebView2
/// camera-permission prompt is resolved up front and never recorded; bounded so a
/// stuck prompt or a missing event can't wedge the start.
///
/// Returns whether movable-mode recording is supported (the `rec-cam-ready` payload's
/// `movableOk`, i.e. MediaRecorder/VP8). Defaults `true` on timeout/parse issues; only
/// consulted for movable recordings.
async fn wait_for_cam_ready(app: &AppHandle) -> bool {
    use tauri::Listener;
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let txr = tx.clone();
    let ready = app.once("rec-cam-ready", move |e| {
        let movable_ok = serde_json::from_str::<serde_json::Value>(e.payload())
            .ok()
            .and_then(|v| v.get("movableOk").and_then(|b| b.as_bool()))
            .unwrap_or(true);
        if let Some(t) = txr.lock().unwrap().take() { let _ = t.send(movable_ok); }
    });
    let txf = tx.clone();
    let failed = app.once("rec-cam-failed", move |_| {
        if let Some(t) = txf.lock().unwrap().take() { let _ = t.send(true); }
    });
    let movable_ok = tokio::time::timeout(std::time::Duration::from_secs(20), rx)
        .await
        .ok()
        .and_then(|r| r.ok())
        .unwrap_or(true);
    app.unlisten(ready);
    app.unlisten(failed);
    movable_ok
}

/// Start recording. `mode` is "fullscreen" or "region"; region passes x/y/w/h
/// (physical px). Spawns ffmpeg (capture+encode) and stores the child. Off the
/// main thread so the spawn never blocks the event loop.
// Retained: arity is intrinsic to a Tauri command — mode + region geometry
// (x/y/w/h) + the per-source audio/webcam flags are each a distinct IPC field
// the selector passes; a params struct would only add a (de)serialization hop.
#[allow(clippy::too_many_arguments)]
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
    webcam: Option<bool>,
    webcam_movable: Option<bool>,
    click_viz: Option<bool>,
    keystrokes: Option<bool>,
    spotlight: Option<bool>,
    cursor_hide: Option<bool>,
    cursor_size: Option<String>,
) -> Result<(), String> {
    // Already recording? Ignore (single recording in R1).
    if app.state::<RecorderState>().0.lock().unwrap().is_some() {
        return Err("already recording".into());
    }

    // Capture/encode frame rate + movable-webcam default from settings. Reading
    // `record_webcam_movable` here (not only from the selector chip) makes the Settings
    // toggle authoritative — a recording started from anywhere honours it.
    let (fps, setting_movable) = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let s = state.0.lock().unwrap();
        (s.record_fps, s.record_webcam_movable)
    };

    // Choose the capture engine once (cached per session): ddagrab (GPU, true 60 fps)
    // when the machine supports it, else the proven gdigrab path. Fixed for the whole
    // recording so pause/resume segments stay concat-copy compatible.
    let engine = probe_capture_engine(&app).await;

    // The selector (if this start came from it) closes itself, so the frontend's
    // IPC survives (closing destroys its JS context) and a full-screen capture
    // never includes the transparent overlay. No-op for a tray/hotkey fullscreen.
    windows::close_region_selector(&app);
    // Dismiss a lingering post-recording HUD from a previous take.
    windows::close_rec_hud(&app);

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
    // Honor the custom capture folder (falls back to Videos\Glint). Reading `settings` is
    // isolation-safe — the sacred rule only forbids capture/editor/overlay/ocr imports.
    let dir = crate::settings::locations::save_dir(&app, crate::settings::locations::SaveKind::Recording);
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

    // Reserve the start slot for the countdown + spawn window. `state.0` stays None
    // until ffmpeg is up, so the `is_some()` guard at the top can't catch a SECOND
    // trigger fired during the 3s countdown — without this reservation both would
    // spawn an ffmpeg, colliding on the same-second filename (corrupt output) and
    // leaking a span. Released on every exit path below.
    if app.state::<RecorderState>().1.swap(true, Ordering::SeqCst) {
        return Err("already starting".into());
    }

    // Webcam enabled: open the bubble and WAIT for the camera to go live (permission
    // granted) — or fail/timeout — BEFORE the countdown. getUserMedia's WebView2
    // permission prompt is then resolved up front, so it never lands in the recording
    // and the countdown/capture don't begin until the user has pressed Allow. The
    // bubble stays open through the countdown so the user can frame.
    // "Movable" is a webcam *mode* — honoured from the per-recording chip OR the persisted
    // Settings default. Wanting it implies recording the webcam at all, so a user who only
    // flips the Movable toggle still gets a (movable) webcam instead of silently nothing.
    let want_movable_pref = webcam_movable.unwrap_or(false) || setting_movable;
    let want_cam = webcam.unwrap_or(false) || want_movable_pref;
    // `mut` so a pre-start fallback can demote it to baked-in when unsupported.
    let mut want_cam_movable = want_cam && want_movable_pref;
    // Bubble's normalized on-screen placement — persisted for movable recordings so the trim
    // overlay starts at the same spot/size.
    let mut cam_placement: Option<(f64, f64, f64)> = None;
    if want_cam {
        cam_placement = windows::build_cam_bubble(&app, target, 170.0, want_cam_movable).ok().flatten();
        let movable_ok = wait_for_cam_ready(&app).await;
        if want_cam_movable && !movable_ok {
            // MediaRecorder/VP8 unsupported here — rebuild the bubble WITHOUT capture
            // exclusion so gdigrab bakes it in and the user still gets a webcam.
            windows::close_cam_bubble(&app);
            let _ = windows::build_cam_bubble(&app, target, 170.0, false);
            let _ = app.emit("glint-toast", "Movable webcam unavailable — recorded in place");
            want_cam_movable = false;
        }
    }

    // 3-2-1 countdown, then Rust closes it BEFORE capture starts so the digit can
    // never bleed into the first recorded frames (and a webview that failed to
    // self-close isn't left orphaned on screen).
    let _ = windows::build_countdown(&app);
    tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
    windows::close_countdown(&app);

    let audio_cfg = AudioConfig { system: system.unwrap_or(true), mic: mic.unwrap_or(false) };
    // A source off in the selector starts muted so it can be unmuted live.
    let controls = AudioControls::new(!audio_cfg.system, !audio_cfg.mic);
    let any_audio = audio_cfg.system || audio_cfg.mic;

    // Recording FX config, resolved once at start (like audio). Cursor hide/size are
    // start-time only because they change gdigrab's -draw_mouse.
    let fx_cfg = fx::FxConfig {
        click_viz: click_viz.unwrap_or(false),
        keystrokes: keystrokes.unwrap_or(false),
        spotlight: spotlight.unwrap_or(false),
        cursor_hide: cursor_hide.unwrap_or(false),
        cursor_size: match cursor_size.as_deref() { Some("large") => 1, Some("xl") => 2, _ => 0 },
    };

    // Show the control bar IMMEDIATELY (no dead gap while ffmpeg's gdigrab input
    // initializes, which takes ~1s+). A preliminary state with `current: None`
    // backs the bar and gives Stop a target until segment 0 is up; availability is
    // optimistic (both toggles when any audio) and refined once ffmpeg is running.
    *app.state::<RecorderState>().0.lock().unwrap() = Some(ActiveRecording {
        target,
        fps,
        engine,
        out_path: out_str.clone(),
        width,
        height,
        started: Instant::now(),
        seg_index: 1,
        done: Vec::new(),
        current: None,
        audio_cfg,
        sys_avail: any_audio,
        mic_avail: any_audio,
        controls: controls.clone(),
        webcam_on: want_cam,
        webcam_movable: want_cam_movable,
        cam_path: None,
        fx_cfg,
        fx: None,
    });
    let _ = windows::build_control_bar(&app);

    // Bring segment 0 up behind the visible bar. Pause/resume appends further
    // segments; stop concatenates them. 60 fps for smooth motion (gdigrab's actual
    // delivered rate still depends on the machine/screen resolution).
    let seg0 = match spawn_segment(&app, engine, target, fps, &segment_path(&out_str, 0), 0, audio_cfg, &controls, fx_cfg.draw_mouse()).await {
        Ok(s) => s,
        Err(e) => {
            windows::close_control_bar(&app);
            windows::close_cam_bubble(&app);
            *app.state::<RecorderState>().0.lock().unwrap() = None;
            app.state::<RecorderState>().1.store(false, Ordering::SeqCst);
            let _ = app.emit("glint-toast", "Couldn't start the recorder");
            return Err(e);
        }
    };

    // Patch in the running span + accurate per-source availability. Decide under
    // the lock and move `seg0` either into the state or back out, so any teardown
    // await happens after the guard is dropped (the guard isn't Send).
    let sys_avail = seg0.audio.iter().any(|c| c.tag == "sys");
    let mic_avail = seg0.audio.iter().any(|c| c.tag == "mic");
    let orphan = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        match guard.as_mut() {
            Some(rec) => {
                rec.sys_avail = sys_avail;
                rec.mic_avail = mic_avail;
                rec.current = Some(seg0);
                None
            }
            // stop/cancel raced during ffmpeg init — the slot is gone; hand seg0 back.
            None => Some(seg0),
        }
    };
    // Release the start reservation now that the active slot is filled (or the race
    // resolved) — re-entry is governed by the `is_some()` guard from here on.
    app.state::<RecorderState>().1.store(false, Ordering::SeqCst);
    if let Some(seg0) = orphan {
        finish_segment(seg0).await;
        let _ = std::fs::remove_file(segment_path(&out_str, 0));
        return Ok(());
    }
    // Start FX (overlay + input hooks) if any effect is enabled. Built here (not
    // earlier) so the overlay never lands in the countdown frames. Stored on the
    // active recording so stop/cancel can tear it down. If the recording was
    // stopped/canceled during ffmpeg init, the slot is gone — stop the session.
    if fx_cfg.needs_overlay() {
        let session = fx::start(&app, target, fx_cfg);
        let stash = {
            let state = app.state::<RecorderState>();
            let mut guard = state.0.lock().unwrap();
            match guard.as_mut() {
                Some(rec) => { rec.fx = Some(session); None }
                None => Some(session),
            }
        };
        if let Some(session) = stash { session.stop(&app); }
        // Tell the overlay the cursor mode (hide/size) so it draws our own pointer.
        // The overlay may cold-load after this fires, so re-emit once shortly after.
        let mode = serde_json::json!({ "hide": fx_cfg.cursor_hide, "size": fx_cfg.cursor_size });
        let _ = app.emit_to(fx::window::FX_LABEL, "fx-cursor-mode", mode.clone());
        let app2 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            let _ = app2.emit_to(fx::window::FX_LABEL, "fx-cursor-mode", mode);
        });
    }
    let _ = app.emit("recorder-started", ());

    // Movable webcam: hand the bubble the sibling path and tell it to start MediaRecorder
    // at the true capture t=0 (so the .cam.webm shares the screen's timeline).
    if want_cam_movable {
        let cam_path = crate::recorder::cam::cam_sidecar_path(&out_str).to_string_lossy().to_string();
        // Persist the bubble's placement so the trim editor's overlay starts where it was.
        if let Some((nx, ny, nd)) = cam_placement {
            crate::recorder::cam::write_cam_placement(&out_str, nx, ny, nd);
        }
        if let Some(rec) = app.state::<RecorderState>().0.lock().unwrap().as_mut() {
            rec.cam_path = Some(cam_path.clone());
        }
        let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-start", serde_json::json!({ "path": cam_path }));
    }
    Ok(())
}

/// Block until the webcam bubble finishes flushing its `.cam.webm` (`rec-cam-record-saved`),
/// or 3s elapse. Called at stop before the bubble is destroyed, so the sidecar is complete
/// on disk. Bounded so a gone/stuck webview can't wedge stop.
async fn wait_for_cam_saved(app: &AppHandle) {
    use tauri::Listener;
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let txr = tx.clone();
    let saved = app.once("rec-cam-record-saved", move |_| {
        if let Some(t) = txr.lock().unwrap().take() { let _ = t.send(()); }
    });
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), rx).await;
    app.unlisten(saved);
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
    // Mirror the pause to the webcam recorder so both timelines stay aligned.
    let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-pause", ());
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
            // `current.is_none()` also holds during the preliminary start state (seg0
            // not up yet); require a completed span so resume can't run mid-init.
            Some(rec) if rec.current.is_none() && !rec.done.is_empty() => {
                Some((rec.engine, rec.target, rec.fps, rec.out_path.clone(), rec.seg_index, rec.audio_cfg, rec.controls.clone()))
            }
            _ => None,
        }
    };
    let (engine, target, fps, out_path, idx, cfg, controls) = info.ok_or("not paused")?;
    let path = segment_path(&out_path, idx);
    let seg = spawn_segment(&app, engine, target, fps, &path, idx, cfg, &controls, true).await
        .inspect_err(|_e| {
            let _ = app.emit("glint-toast", "Couldn't resume recording");
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
    // Mirror the resume to the webcam recorder.
    let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-resume", ());
    let _ = app.emit("recorder-resumed", ());
    Ok(())
}

/// Stop + finalize: send `q` to ffmpeg (clean MP4), wait briefly, extract a
/// thumbnail, insert the Library row, emit capture-saved. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_stop(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    windows::close_control_bar(&app);
    // Movable webcam: flush + finalize the .cam.webm BEFORE destroying the bubble webview.
    if rec.as_ref().is_some_and(|r| r.cam_path.is_some()) {
        let _ = app.emit_to(windows::CAM_LABEL, "rec-cam-record-stop", ());
        wait_for_cam_saved(&app).await;
    }
    windows::close_cam_bubble(&app);
    let rec = rec.ok_or("not recording")?;
    let ActiveRecording { out_path, width, height, mut done, current, fx, .. } = rec;
    // Tear down FX (unhook input, destroy overlay) now that the recording is ending.
    if let Some(session) = fx { session.stop(&app); }

    // Finish the running span (None if we stopped while paused), then stitch all
    // recorded spans into the final file. Each span exits cleanly (q + wait) so
    // its moov atom is written before the concat/rename.
    if let Some(seg) = current {
        let p = seg.path.clone();
        finish_segment(seg).await;
        done.push(p);
    }
    // Stopped before any span was captured (e.g. Stop tapped during the ~1s ffmpeg
    // init) — nothing to save, and it wasn't a failure, so discard quietly.
    if done.is_empty() {
        let _ = app.emit("recorder-stopped", ());
        return Ok(());
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
    let rec_id = {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        match crate::db::insert_capture(&conn, &row) {
            Ok(id) => Some(id),
            Err(e) => {
                log::error!("recording insert_capture failed: {e}");
                None
            }
        }
    };
    let _ = app.emit("capture-saved", ());
    let _ = app.emit("recorder-stopped", ());

    // Post-recording HUD: a floating panel with the new video's thumbnail + quick
    // drag-out / Open / Reveal / Copy-path actions (CleanShot-style), so the user
    // can act on the recording without opening the Library. Only on a real save.
    if let Some(id) = rec_id {
        *app.state::<RecorderHud>().0.lock().unwrap() = Some(LastRecording {
            id,
            path: out_path.clone(),
            thumb_path: row.thumb_path.clone(),
        });
        let _ = windows::build_rec_hud(&app);
    } else {
        let _ = app.emit("glint-toast", "Recording saved");
    }
    Ok(())
}

/// Discard an in-flight recording: stop ffmpeg and delete the partial file.
#[tauri::command(async)]
pub async fn recorder_cancel(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    windows::close_control_bar(&app);
    windows::close_cam_bubble(&app);
    windows::close_countdown(&app); // in case cancel races the countdown
    if let Some(ActiveRecording { mut done, current, out_path, fx, cam_path, .. }) = rec {
        // Tear down FX (unhook input, destroy overlay) on discard.
        if let Some(session) = fx { session.stop(&app); }
        // Drop any partial webcam sidecar + placement written before cancel.
        if let Some(cp) = cam_path { let _ = std::fs::remove_file(cp); }
        let _ = std::fs::remove_file(crate::recorder::cam::cam_placement_path(&out_path));
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

/// Take the FX session out of the active recording (if any), dropping the lock.
fn take_fx_session(app: &tauri::AppHandle) -> Option<fx::FxSession> {
    app.state::<RecorderState>().0.lock().unwrap().as_mut().and_then(|r| r.fx.take())
}

/// Store the session back on the active recording, or — if the recording vanished
/// meanwhile (stop/cancel raced) — stop it so a global hook can't leak. The lock is
/// always dropped before `stop` (which builds/destroys a window).
fn stash_fx_session(app: &tauri::AppHandle, session: fx::FxSession) {
    let orphan = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        match guard.as_mut() {
            Some(rec) => { rec.fx = Some(session); None }
            None => Some(session),
        }
    };
    if let Some(o) = orphan {
        o.stop(app);
    }
}

/// Live-toggle an overlay-drawn effect (click_viz | keystrokes | spotlight). Cursor
/// hide/size are start-time only (they change gdigrab args) and are rejected here.
/// Async: it may build/close the rec-fx window + (re)install hooks, which must run
/// off the main thread (window-build rule). Notifies the overlay renderers and the
/// control bar so both reflect the change.
#[tauri::command(async)]
pub async fn recorder_set_fx(app: tauri::AppHandle, effect: String, on: bool) -> Result<(), String> {
    // Mutate the config under the lock; drop the lock before any window/hook work.
    let (cfg_after, had_overlay, target) = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        let rec = guard.as_mut().ok_or("not recording")?;
        let had_overlay = rec.fx_cfg.needs_overlay();
        match effect.as_str() {
            "click_viz" => rec.fx_cfg.click_viz = on,
            "keystrokes" => rec.fx_cfg.keystrokes = on,
            "spotlight" => rec.fx_cfg.spotlight = on,
            "cursor_hide" | "cursor_size" => return Err("cursor options are set at start".into()),
            other => return Err(format!("unknown effect: {other}")),
        }
        (rec.fx_cfg, had_overlay, rec.target)
    };
    let now_needs = cfg_after.needs_overlay();

    if now_needs && !had_overlay {
        // From all-off → create the session (overlay + hooks).
        stash_fx_session(&app, fx::start(&app, target, cfg_after));
    } else if !now_needs && had_overlay {
        // Last effect turned off → tear the session down.
        if let Some(session) = take_fx_session(&app) {
            session.stop(&app);
        }
    } else if now_needs {
        // Overlay stays; restart hooks to refresh flags / (re)install the keyboard hook.
        if let Some(mut session) = take_fx_session(&app) {
            session.restart_hooks(&app, cfg_after);
            stash_fx_session(&app, session);
        }
    }

    // Renderers update instantly; the control bar toggle reflects the new state.
    let _ = app.emit_to(fx::window::FX_LABEL, "fx-config", serde_json::json!({
        "click_viz": cfg_after.click_viz, "keystrokes": cfg_after.keystrokes, "spotlight": cfg_after.spotlight,
    }));
    let _ = app.emit_to(windows::BAR_LABEL, "recorder-fx", serde_json::json!({ "effect": effect, "on": on }));
    Ok(())
}

/// Stash the trim target and grant the asset protocol read access to this exact file so
/// the trim window's `<video>` can load it even when it lives outside `Videos\Glint`
/// (external files opened via Explorer). For in-scope recordings the `allow_file` is a
/// harmless no-op. Cheap + thread-safe — only the window *build* is thread-sensitive.
fn prepare_trim_target(app: &tauri::AppHandle, id: i64, path: String) {
    let _ = app.asset_protocol_scope().allow_file(&path);
    *app.state::<RecorderTrimState>().0.lock().unwrap() = Some(TrimTarget { id, path });
}

/// Open the trim window for a recording (from the HUD or Library). Single instance:
/// if one is already open, focus it and toast rather than retargeting. Async because
/// it builds a WebView2 window (must stay off the main thread — window-build rule).
#[tauri::command(async)]
pub async fn recorder_open_trim(app: tauri::AppHandle, id: i64, path: String) -> Result<(), String> {
    if app.get_webview_window(windows::TRIM_LABEL).is_some() {
        let _ = windows::build_trim_window(&app); // focuses existing
        let _ = app.emit("glint-toast", "Close the current trim first");
        return Ok(());
    }
    prepare_trim_target(&app, id, path);
    windows::build_trim_window(&app).map_err(|e| e.to_string())
}

/// Open the trim window for a file opened via Explorer ("Open in Glint" on a video).
/// Resolves the Library row by path when the file is a known capture (so Overwrite
/// updates the right row); otherwise opens it as an external file (id -1). Safe to call
/// from the main thread — the window build is spawned off-thread (window-build rule).
pub fn open_trim_for_external(app: &tauri::AppHandle, path: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if app.get_webview_window(windows::TRIM_LABEL).is_some() {
            let _ = windows::build_trim_window(&app); // focus existing
            let _ = app.emit("glint-toast", "Close the current trim first");
            return;
        }
        let id = {
            let db = app.state::<crate::Db>();
            let conn = db.0.lock().unwrap();
            crate::db::find_capture_id_by_path(&conn, &path).unwrap_or(-1)
        };
        prepare_trim_target(&app, id, path);
        if let Err(e) = windows::build_trim_window(&app) {
            let _ = app.emit("glint-toast", format!("Couldn't open trim: {e}"));
        }
    });
}

/// The trim window reads back which recording it should edit.
#[tauri::command]
pub fn recorder_trim_target(app: tauri::AppHandle) -> Option<TrimTargetDto> {
    app.state::<RecorderTrimState>().0.lock().unwrap()
        .as_ref()
        .map(|t| TrimTargetDto { id: t.id, path: t.path.clone() })
}

#[tauri::command]
pub fn recorder_status(app: tauri::AppHandle) -> Option<RecorderStatusDto> {
    let state = app.state::<RecorderState>();
    let guard = state.0.lock().unwrap();
    guard.as_ref().map(|r| RecorderStatusDto {
        recording: true,
        elapsed_secs: r.started.elapsed().as_secs(),
        system: r.sys_avail,
        mic: r.mic_avail,
        system_muted: r.controls.system_muted.load(std::sync::atomic::Ordering::Relaxed),
        mic_muted: r.controls.mic_muted.load(std::sync::atomic::Ordering::Relaxed),
        webcam: r.webcam_on,
        click_viz: r.fx_cfg.click_viz,
        keystrokes: r.fx_cfg.keystrokes,
        spotlight: r.fx_cfg.spotlight,
        cursor_hide: r.fx_cfg.cursor_hide,
        cursor_size: match r.fx_cfg.cursor_size { 1 => "large".into(), 2 => "xl".into(), _ => "off".into() },
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

/// Toggle the webcam bubble live. Independent of ffmpeg (just a sibling on-screen
/// window gdigrab records), so this is instant — no segment restart. No-op-erroring
/// if not recording.
///
/// MUST be `#[tauri::command(async)]`: it builds/closes a WebView2 window
/// (`build_cam_bubble`/`close_cam_bubble`), and per windows.rs those builds have to
/// run OFF the main thread or they deadlock WebView2 — freezing the WHOLE app (the
/// control bar, selector, HUD, main window all share one WebView2 process). A sync
/// command runs on the main thread, so the control-bar webcam toggle and the bubble's
/// ✕ both hard-locked the app until Alt-F4. The std::Mutex guard below is dropped
/// before this function ever yields, so making it async stays sound.
#[tauri::command(async)]
pub async fn recorder_set_webcam(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let target = {
        let state = app.state::<RecorderState>();
        let mut guard = state.0.lock().unwrap();
        let rec = guard.as_mut().ok_or("not recording")?;
        rec.webcam_on = on;
        (rec.target, rec.webcam_movable)
    };
    let (target, movable) = target;
    if on { let _ = windows::build_cam_bubble(&app, target, 170.0, movable); }
    else { windows::close_cam_bubble(&app); }
    // Notify the control bar so its toggle reflects the change — this is the path the
    // bubble's ✕ button takes, and the bar would otherwise still read "on".
    let _ = app.emit_to(windows::BAR_LABEL, "recorder-webcam", on);
    Ok(())
}
