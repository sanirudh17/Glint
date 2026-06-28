//! Screen recorder (R1: silent video). ISOLATED — owns the bundled ffmpeg
//! sidecar; the screenshot/library/editor path imports nothing from here. The
//! only outbound coupling is on stop: write the MP4 + insert one Library row.

pub mod ffmpeg;

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

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
