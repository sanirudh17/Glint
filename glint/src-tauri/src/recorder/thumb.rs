//! First-frame thumbnail for a finished recording — a quick second ffmpeg pass.
//! Recorder-owned (no call into capture/). Non-fatal: returns None on any failure.

use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;

pub async fn extract_thumb(app: &AppHandle, mp4_path: &str) -> Option<String> {
    let dir = app.path().app_local_data_dir().ok()?;
    let dir = crate::paths::thumbs_dir(&dir);
    std::fs::create_dir_all(&dir).ok()?;
    let stem = std::path::Path::new(mp4_path).file_stem()?.to_string_lossy().to_string();
    let thumb = dir.join(format!("{stem}.png"));
    let thumb_str = thumb.to_string_lossy().to_string();
    let status = app
        .shell()
        .sidecar("ffmpeg").ok()?
        .args(["-y", "-i", mp4_path, "-ss", "0", "-vframes", "1", "-vf", "scale=480:-1", &thumb_str])
        .output()
        .await
        .ok()?;
    if status.status.success() && thumb.exists() { Some(thumb_str) } else { None }
}
