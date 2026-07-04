//! Independent-webcam sidecar I/O. ISOLATED (recorder-owned): when a recording is made
//! in "movable" mode, the `rec-cam` webview records its own camera stream via MediaRecorder
//! and streams the chunks here; we append them to `<stem>.cam.webm` next to the screen
//! recording. The trim editor later composites that track as a movable overlay. Imports
//! nothing from capture/editor/overlay/ocr.

use std::io::Write;
use std::path::{Path, PathBuf};

/// `<dir>/<stem>.cam.webm` beside the screen recording — the sibling webcam track.
// Consumed by `recorder_start` (A4) and `recorder_trim_probe` (B1); the allow is dropped
// once those reference it.
#[allow(dead_code)]
pub fn cam_sidecar_path(screen_mp4: &str) -> PathBuf {
    let p = Path::new(screen_mp4);
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Glint".into());
    dir.join(format!("{stem}.cam.webm"))
}

/// Append (or, when `first`, create/truncate) one MediaRecorder chunk to `path`. The
/// webview calls this per `ondataavailable`, so the whole video is never held in memory.
#[tauri::command(async)]
pub async fn recorder_cam_write_chunk(
    _app: tauri::AppHandle,
    path: String,
    bytes: Vec<u8>,
    first: bool,
) -> Result<(), String> {
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(first)
        .append(!first)
        .open(&path)
        .map_err(|e| format!("cam open: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("cam write: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_is_stem_dot_cam_webm() {
        let p = cam_sidecar_path(r"C:\v\Glint 2026 at 10.00.00.mp4");
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "Glint 2026 at 10.00.00.cam.webm");
        assert_eq!(p.parent().unwrap().to_string_lossy(), r"C:\v");
    }
}
