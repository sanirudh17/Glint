//! Independent-webcam sidecar I/O. ISOLATED (recorder-owned): when a recording is made
//! in "movable" mode, the `rec-cam` webview records its own camera stream via MediaRecorder
//! and streams the chunks here; we append them to `<stem>.cam.webm` next to the screen
//! recording. The trim editor later composites that track as a movable overlay. Imports
//! nothing from capture/editor/overlay/ocr.

use std::io::Write;
use std::path::{Path, PathBuf};

/// `<dir>/<stem>.cam.webm` beside the screen recording — the sibling webcam track.
pub fn cam_sidecar_path(screen_mp4: &str) -> PathBuf {
    let p = Path::new(screen_mp4);
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Glint".into());
    dir.join(format!("{stem}.cam.webm"))
}

/// `<dir>/<stem>.cam.json` beside the recording — the webcam's on-screen placement at record
/// time (normalized), so the trim editor starts its overlay where the bubble actually was.
pub fn cam_placement_path(screen_mp4: &str) -> PathBuf {
    let p = Path::new(screen_mp4);
    let dir = p.parent().unwrap_or_else(|| Path::new("."));
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Glint".into());
    dir.join(format!("{stem}.cam.json"))
}

/// Read `<stem>.cam.json` → `(x, y, diameter, shape)` normalized. `None` if absent/malformed
/// (the editor then falls back to its default placement). Legacy files (Phase 21) carry no
/// shape → "circle".
pub fn read_cam_placement(screen_mp4: &str) -> Option<(f64, f64, f64, String)> {
    let raw = std::fs::read_to_string(cam_placement_path(screen_mp4)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let x = v.get("x")?.as_f64()?;
    let y = v.get("y")?.as_f64()?;
    let d = v.get("diameter")?.as_f64()?;
    let shape = v.get("shape").and_then(|s| s.as_str()).unwrap_or("circle").to_string();
    Some((x, y, d, shape))
}

/// Write the webcam's normalized placement + shape beside the recording.
pub fn write_cam_placement(screen_mp4: &str, x: f64, y: f64, diameter: f64, shape: &str) {
    let json = format!("{{\"x\":{x},\"y\":{y},\"diameter\":{diameter},\"shape\":\"{shape}\"}}");
    let _ = std::fs::write(cam_placement_path(screen_mp4), json);
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

    #[test]
    fn placement_roundtrips_shape() {
        let dir = std::env::temp_dir().join("glint-cam-test");
        std::fs::create_dir_all(&dir).unwrap();
        let mp4 = dir.join("clip.mp4");
        let mp4s = mp4.to_string_lossy().to_string();
        write_cam_placement(&mp4s, 0.1, 0.2, 0.25, "rounded");
        let got = read_cam_placement(&mp4s).unwrap();
        assert_eq!(got.3, "rounded");
        assert!((got.0 - 0.1).abs() < 1e-9);
        assert!((got.2 - 0.25).abs() < 1e-9);
        let _ = std::fs::remove_file(cam_placement_path(&mp4s));
    }

    #[test]
    fn legacy_placement_without_shape_defaults_circle() {
        let dir = std::env::temp_dir().join("glint-cam-test-legacy");
        std::fs::create_dir_all(&dir).unwrap();
        let mp4 = dir.join("old.mp4");
        let mp4s = mp4.to_string_lossy().to_string();
        std::fs::write(cam_placement_path(&mp4s), r#"{"x":0.1,"y":0.2,"diameter":0.3}"#).unwrap();
        let got = read_cam_placement(&mp4s).unwrap();
        assert_eq!(got.3, "circle");
        let _ = std::fs::remove_file(cam_placement_path(&mp4s));
    }
}
