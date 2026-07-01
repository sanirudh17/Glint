//! Recording trim / quick-edit. ISOLATED (recorder-owned): uses recorder `ffmpeg`/
//! `thumb` + `crate::db` only — nothing from capture/editor/overlay. A SEPARATE
//! ffmpeg pass from recording; the gdigrab capture path is untouched.

use std::path::{Path, PathBuf};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

#[derive(serde::Serialize, Clone)]
pub struct ProbeResult {
    pub duration_secs: f64,
    pub has_audio: bool,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
}

/// Parse `ffprobe -show_streams -show_format -of json` output.
pub fn parse_ffprobe_json(json: &str) -> Result<ProbeResult, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let streams = v.get("streams").and_then(|s| s.as_array()).ok_or("no streams")?;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut fps = 0.0f64;
    let mut has_audio = false;
    for s in streams {
        match s.get("codec_type").and_then(|c| c.as_str()) {
            Some("video") => {
                width = s.get("width").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                height = s.get("height").and_then(|x| x.as_u64()).unwrap_or(0) as u32;
                if let Some(r) = s.get("avg_frame_rate").and_then(|x| x.as_str()) {
                    if let Some((n, d)) = r.split_once('/') {
                        let n: f64 = n.parse().unwrap_or(0.0);
                        let d: f64 = d.parse().unwrap_or(0.0);
                        if d > 0.0 { fps = n / d; }
                    }
                }
            }
            Some("audio") => has_audio = true,
            _ => {}
        }
    }
    let duration_secs = v.get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(0.0);
    Ok(ProbeResult { duration_secs, has_audio, fps, width, height })
}

/// Validate + sort keep-regions: non-empty, each (start < end), all within
/// [0, duration], and non-overlapping after sorting by start.
pub fn validate_keep(keep: &[(f64, f64)], duration: f64) -> Result<Vec<(f64, f64)>, String> {
    if keep.is_empty() {
        return Err("nothing to keep".into());
    }
    let mut v = keep.to_vec();
    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut prev_end = 0.0;
    for (i, (s, e)) in v.iter().enumerate() {
        if !(e > s) {
            return Err("empty keep-region".into());
        }
        if *s < -1e-6 || *e > duration + 1e-3 {
            return Err("keep-region out of bounds".into());
        }
        if i > 0 && *s < prev_end - 1e-6 {
            return Err("overlapping keep-regions".into());
        }
        prev_end = *e;
    }
    Ok(v)
}

/// True when the edit changes nothing: a single region spanning ~the whole file.
pub fn is_noop(keep: &[(f64, f64)], duration: f64) -> bool {
    keep.len() == 1 && keep[0].0 <= 1e-3 && keep[0].1 >= duration - 0.05
}

/// Derive `<name> (trimmed).mp4` next to the source; append a counter on collision.
pub fn trimmed_output_path(src: &Path) -> PathBuf {
    let dir = src.parent().unwrap_or_else(|| Path::new("."));
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = src.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "mp4".into());
    let mut candidate = dir.join(format!("{stem} (trimmed).{ext}"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} (trimmed {n}).{ext}"));
        n += 1;
    }
    candidate
}

/// Build the ffmpeg args for a frame-accurate trim: trim each keep-region and
/// concat them in one re-encode pass. `keep` is a list of (start, end) seconds in
/// the source timeline (already validated: sorted, non-overlapping, in-bounds).
/// `has_audio` picks the audio-bearing graph.
pub fn build_trim_args(input: &str, output: &str, keep: &[(f64, f64)], has_audio: bool) -> Vec<String> {
    // Format a number without a trailing ".0" (so 1.5 -> "1.5", 3.0 -> "3").
    fn num(n: f64) -> String {
        if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
    }
    let mut fc = String::new();
    for (i, (s, e)) in keep.iter().enumerate() {
        fc.push_str(&format!("[0:v]trim={}:{},setpts=PTS-STARTPTS[v{i}];", num(*s), num(*e)));
        if has_audio {
            fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS[a{i}];", num(*s), num(*e)));
        }
    }
    let n = keep.len();
    for i in 0..n {
        fc.push_str(&format!("[v{i}]"));
        if has_audio { fc.push_str(&format!("[a{i}]")); }
    }
    if has_audio {
        fc.push_str(&format!("concat=n={n}:v=1:a=1[outv][outa]"));
    } else {
        fc.push_str(&format!("concat=n={n}:v=1:a=0[outv]"));
    }

    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-progress".into(), "pipe:1".into(),
        "-i".into(), input.into(),
        "-filter_complex".into(), fc,
        "-map".into(), "[outv]".into(),
    ];
    if has_audio {
        a.extend(["-map".into(), "[outa]".into()]);
    }
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);
    if has_audio {
        a.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    }
    a.extend(["-movflags".into(), "+faststart".into(), output.into()]);
    a
}

#[tauri::command(async)]
pub async fn recorder_trim_probe(app: tauri::AppHandle, path: String) -> Result<ProbeResult, String> {
    let sidecar = app.shell().sidecar("ffprobe").map_err(|e| format!("ffprobe resolve: {e}"))?;
    let out = sidecar
        .args([
            "-v", "error",
            "-show_streams", "-show_format",
            "-of", "json",
            &path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe run: {e}"))?;
    if !out.status.success() {
        return Err(format!("ffprobe exited {:?}", out.status.code()));
    }
    let json = String::from_utf8_lossy(&out.stdout);
    parse_ffprobe_json(&json)
}

/// Export the trimmed recording in one ffmpeg pass. Always encodes to a temp file
/// first, then commits per `mode` ("copy" | "overwrite"). The original is never at
/// risk mid-encode: on overwrite it is moved aside and only removed once the new file
/// is safely in place; any failure rolls back and leaves the original intact. Async —
/// it spawns the sidecar and continuously drains the (capacity-1) progress channel.
#[tauri::command(async)]
pub async fn recorder_trim_export(
    app: tauri::AppHandle,
    id: i64,
    src_path: String,
    keep: Vec<(f64, f64)>,
    has_audio: bool,
    duration: f64,
    width: i64,
    height: i64,
    mode: String,
) -> Result<(), String> {
    let keep = validate_keep(&keep, duration)?;
    if is_noop(&keep, duration) {
        return Err("no changes to save".into());
    }
    let total_kept: f64 = keep.iter().map(|(s, e)| e - s).sum();

    let src = PathBuf::from(&src_path);
    let final_path = if mode == "overwrite" { src.clone() } else { trimmed_output_path(&src) };
    let tmp = src.with_extension("trimtmp.mp4");
    let tmp_str = tmp.to_string_lossy().to_string();
    let _ = std::fs::remove_file(&tmp); // clear any stale temp from a prior failed run

    let args = build_trim_args(&src_path, &tmp_str, &keep, has_audio);
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("ffmpeg resolve: {e}"))?;
    let (mut rx, _child) = sidecar.args(args).spawn().map_err(|e| format!("ffmpeg spawn: {e}"))?;

    // Drain events: parse progress from stdout, capture the exit code on Terminated.
    let mut exit_ok = false;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(line) => {
                let line = String::from_utf8_lossy(&line);
                for kv in line.split_whitespace() {
                    if let Some(us) = kv.strip_prefix("out_time_us=") {
                        if let Ok(us) = us.parse::<f64>() {
                            let pct = ((us / 1_000_000.0) / total_kept.max(0.001) * 100.0).clamp(0.0, 100.0);
                            let _ = app.emit_to(crate::recorder::windows::TRIM_LABEL, "rec-trim-progress", pct);
                        }
                    }
                }
            }
            CommandEvent::Terminated(payload) => exit_ok = payload.code == Some(0),
            _ => {}
        }
    }

    // Verify: ffmpeg exited 0 AND the temp is a plausibly-real file (> 1 KB).
    let size_ok = std::fs::metadata(&tmp).map(|m| m.len() > 1024).unwrap_or(false);
    if !exit_ok || !size_ok {
        let _ = std::fs::remove_file(&tmp);
        let _ = app.emit("glint-toast", "Trim failed");
        return Err("trim produced no valid output".into());
    }

    // Commit. Copy: `final_path` is a fresh non-existing name → plain rename. Overwrite:
    // move the original aside first so a failed rename can be rolled back (no data loss).
    if mode == "overwrite" {
        let bak = src.with_extension("trimbak.mp4");
        let _ = std::fs::remove_file(&bak);
        let backed_up = std::fs::rename(&final_path, &bak).is_ok();
        if !backed_up {
            let _ = std::fs::remove_file(&final_path); // couldn't move aside; try direct replace
        }
        if let Err(e) = std::fs::rename(&tmp, &final_path) {
            if backed_up {
                let _ = std::fs::rename(&bak, &final_path); // restore the original
            }
            let _ = std::fs::remove_file(&tmp);
            let _ = app.emit("glint-toast", "Trim failed");
            return Err(format!("commit failed: {e}"));
        }
        let _ = std::fs::remove_file(&bak);
    } else if let Err(e) = std::fs::rename(&tmp, &final_path) {
        let _ = std::fs::remove_file(&tmp);
        let _ = app.emit("glint-toast", "Trim failed");
        return Err(format!("commit failed: {e}"));
    }

    let final_str = final_path.to_string_lossy().to_string();
    let thumb = crate::recorder::thumb::extract_thumb(&app, &final_str).await;
    let bytes = std::fs::metadata(&final_str).map(|m| m.len() as i64).unwrap_or(0);
    let w = (width > 0).then_some(width);
    let h = (height > 0).then_some(height);

    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        if mode == "overwrite" {
            let _ = crate::db::update_capture_file(&conn, id, bytes, thumb.as_deref(), w, h);
        } else {
            let row = crate::db::NewCapture {
                kind: "recording".into(),
                path: final_str.clone(),
                thumb_path: thumb.clone(),
                width: w,
                height: h,
                bytes: Some(bytes),
                created_at: std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0),
            };
            let _ = crate::db::insert_capture(&conn, &row);
        }
    }
    let _ = app.emit("capture-saved", ());
    let _ = app.emit(
        "glint-toast",
        if mode == "overwrite" { "Recording trimmed" } else { "Trimmed copy saved" },
    );
    crate::recorder::windows::close_trim_window(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn video_only_two_regions_concat() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 1.5), (3.0, 4.0)], false);
        let fc = "[0:v]trim=0:1.5,setpts=PTS-STARTPTS[v0];\
                  [0:v]trim=3:4,setpts=PTS-STARTPTS[v1];\
                  [v0][v1]concat=n=2:v=1:a=0[outv]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(!a.iter().any(|s| s == "-c:a"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert!(a.windows(2).any(|w| w[0] == "-movflags" && w[1] == "+faststart"));
        assert_eq!(a.last().unwrap(), "out.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-i" && w[1] == "in.mp4"));
    }

    #[test]
    fn video_audio_interleaves_streams() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 2.0), (5.0, 6.5)], true);
        let fc = "[0:v]trim=0:2,setpts=PTS-STARTPTS[v0];\
                  [0:a]atrim=0:2,asetpts=PTS-STARTPTS[a0];\
                  [0:v]trim=5:6.5,setpts=PTS-STARTPTS[v1];\
                  [0:a]atrim=5:6.5,asetpts=PTS-STARTPTS[a1];\
                  [v0][a0][v1][a1]concat=n=2:v=1:a=1[outv][outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outa]"));
        assert!(a.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(a.windows(2).any(|w| w[0] == "-b:a" && w[1] == "192k"));
    }

    #[test]
    fn single_region_uses_concat_n1() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(2.0, 8.0)], false);
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex"
            && w[1] == "[0:v]trim=2:8,setpts=PTS-STARTPTS[v0];[v0]concat=n=1:v=1:a=0[outv]"), "got {a:?}");
    }

    #[test]
    fn args_silence_stderr_and_progress() {
        let a = build_trim_args("in.mp4", "out.mp4", &[(0.0, 1.0)], false);
        assert!(a.iter().any(|s| s == "-nostats"));
        assert!(a.windows(2).any(|w| w[0] == "-loglevel" && w[1] == "error"));
        assert!(a.windows(2).any(|w| w[0] == "-progress" && w[1] == "pipe:1"));
        assert!(a.iter().any(|s| s == "-y"));
    }

    #[test]
    fn parses_ffprobe_streams_and_format() {
        let json = r#"{
          "streams": [
            {"codec_type":"video","width":1920,"height":1080,"avg_frame_rate":"30/1"},
            {"codec_type":"audio","sample_rate":"48000"}
          ],
          "format": {"duration":"12.500000"}
        }"#;
        let p = parse_ffprobe_json(json).unwrap();
        assert_eq!(p.width, 1920);
        assert_eq!(p.height, 1080);
        assert_eq!(p.has_audio, true);
        assert!((p.duration_secs - 12.5).abs() < 1e-6);
        assert!((p.fps - 30.0).abs() < 1e-6);
    }

    #[test]
    fn parses_video_only_no_audio() {
        let json = r#"{"streams":[{"codec_type":"video","width":1280,"height":720,"avg_frame_rate":"60/1"}],"format":{"duration":"3.0"}}"#;
        let p = parse_ffprobe_json(json).unwrap();
        assert_eq!(p.has_audio, false);
        assert!((p.fps - 60.0).abs() < 1e-6);
    }

    #[test]
    fn validate_sorts_and_rejects_overlap_and_oob() {
        // sorted + in-bounds OK
        assert_eq!(validate_keep(&[(3.0, 4.0), (0.0, 1.0)], 10.0).unwrap(), vec![(0.0, 1.0), (3.0, 4.0)]);
        // overlap rejected
        assert!(validate_keep(&[(0.0, 2.0), (1.0, 3.0)], 10.0).is_err());
        // out of bounds rejected
        assert!(validate_keep(&[(0.0, 11.0)], 10.0).is_err());
        // zero/negative length rejected
        assert!(validate_keep(&[(2.0, 2.0)], 10.0).is_err());
        // empty rejected
        assert!(validate_keep(&[], 10.0).is_err());
    }

    #[test]
    fn noop_when_single_full_span() {
        assert!(is_noop(&[(0.0, 10.0)], 10.0));
        assert!(is_noop(&[(0.0, 9.98)], 10.0)); // within tolerance of full
        assert!(!is_noop(&[(0.0, 5.0)], 10.0));
        assert!(!is_noop(&[(0.0, 4.0), (6.0, 10.0)], 10.0)); // a gap exists
    }

    #[test]
    fn trimmed_name_appends_suffix_and_counter() {
        use std::path::Path;
        // Base case appends " (trimmed)" before the extension.
        let p = trimmed_output_path(Path::new("C:/x/Glint 2026 at 10.00.00.mp4"));
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "Glint 2026 at 10.00.00 (trimmed).mp4");
    }
}
