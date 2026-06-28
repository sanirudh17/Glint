//! Screen recorder (R1: silent video). ISOLATED — owns the bundled ffmpeg
//! sidecar; the screenshot/library/editor path imports nothing from here. The
//! only outbound coupling is on stop: write the MP4 + insert one Library row.

pub mod ffmpeg;
pub mod thumb;
pub mod windows;

use std::sync::Mutex;
use std::time::Instant;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// One in-flight recording. Holds the ffmpeg child so stop can talk to its stdin,
/// plus the event receiver so stop can wait for ffmpeg to actually exit (and
/// finish writing the moov atom) rather than guessing with a fixed delay.
pub struct ActiveRecording {
    pub child: CommandChild,
    pub rx: tauri::async_runtime::Receiver<CommandEvent>,
    pub out_path: String,
    pub width: u32,
    pub height: u32,
    pub started: Instant,
}

#[derive(Default)]
pub struct RecorderState(pub Mutex<Option<ActiveRecording>>);

#[derive(Serialize)]
pub struct RecorderStatusDto {
    pub recording: bool,
    pub elapsed_secs: u64,
}

/// What to record. Region coords/size are PHYSICAL pixels on the primary monitor.
#[derive(Clone, Copy, Debug)]
pub enum RecordTarget {
    Fullscreen,
    Region { x: i32, y: i32, w: u32, h: u32 },
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
) -> Result<(), String> {
    // Already recording? Ignore (single recording in R1).
    if app.state::<RecorderState>().0.lock().unwrap().is_some() {
        return Err("already recording".into());
    }

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

    let args = ffmpeg::build_ffmpeg_args(&target, 30, &out_str);
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| {
        let _ = app.emit("glint-toast", "Couldn't start the recorder");
        format!("sidecar resolve: {e}")
    })?;
    let (rx, child) = sidecar.args(args).spawn().map_err(|e| {
        let _ = app.emit("glint-toast", "Couldn't start the recorder");
        format!("ffmpeg spawn: {e}")
    })?;

    *app.state::<RecorderState>().0.lock().unwrap() = Some(ActiveRecording {
        child,
        rx,
        out_path: out_str,
        width,
        height,
        started: Instant::now(),
    });
    let _ = windows::build_control_bar(&app);
    let _ = app.emit("recorder-started", ());
    Ok(())
}

/// Stop + finalize: send `q` to ffmpeg (clean MP4), wait briefly, extract a
/// thumbnail, insert the Library row, emit capture-saved. Off the main thread.
#[tauri::command(async)]
pub async fn recorder_stop(app: tauri::AppHandle) -> Result<(), String> {
    let rec = app.state::<RecorderState>().0.lock().unwrap().take();
    windows::close_control_bar(&app);
    let rec = rec.ok_or("not recording")?;
    let ActiveRecording { mut child, mut rx, out_path, width, height, .. } = rec;

    // Graceful stop: ffmpeg quits on 'q' (trailing newline so the byte reliably
    // reaches its stdin reader on Windows) and writes the moov atom. We then WAIT
    // for ffmpeg to actually exit — finalizing/`+faststart` can take well over a
    // second on a long recording — instead of guessing with a fixed delay. Killing
    // mid-finalize corrupts the MP4, so kill is only a last resort if ffmpeg is
    // still alive 30s after `q`.
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
        log::warn!("ffmpeg did not exit within 30s of 'q'; killing as a last resort");
        let _ = child.kill();
    }

    if !std::path::Path::new(&out_path).exists() {
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
    if let Some(ActiveRecording { mut child, out_path, .. }) = rec {
        // Discarding the file, so finalization doesn't matter — ask ffmpeg to quit,
        // give it a brief grace, then ensure the process is gone and delete the partial.
        let _ = child.write(b"q\n");
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        let _ = child.kill();
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
    })
}
