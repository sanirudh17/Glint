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

/// One kept segment of the source timeline, exported at `speed` (0.5–2×).
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
pub struct KeepSegment {
    pub start: f64,
    pub end: f64,
    pub speed: f64,
}

/// Output (exported) duration: each kept segment contributes `(end-start)/speed`.
pub fn output_duration(segments: &[KeepSegment]) -> f64 {
    segments.iter().map(|s| (s.end - s.start) / s.speed).sum()
}

/// Reduce interleaved mono `s16le` PCM into `buckets` normalized peak values in [0,1]
/// (per-bucket max |sample| / i16::MAX). Pure + unit-tested; `recorder_trim_waveform`
/// is the thin ffmpeg+IO wrapper. Returns all-zeros for empty input, empty for 0 buckets.
pub fn peaks_from_pcm_s16le(bytes: &[u8], buckets: usize) -> Vec<f32> {
    if buckets == 0 {
        return Vec::new();
    }
    let n_samples = bytes.len() / 2;
    if n_samples == 0 {
        return vec![0.0; buckets];
    }
    let mut out = vec![0.0f32; buckets];
    for i in 0..n_samples {
        let s = i16::from_le_bytes([bytes[i * 2], bytes[i * 2 + 1]]);
        let amp = (s as f32).abs() / i16::MAX as f32;
        let b = (i * buckets / n_samples).min(buckets - 1);
        if amp > out[b] {
            out[b] = amp;
        }
    }
    out
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

/// Validate + sort kept segments: non-empty, each (start < end), all within [0, duration],
/// non-overlapping after sorting by start, and speed within [0.5, 2].
pub fn validate_segments(segments: &[KeepSegment], duration: f64) -> Result<Vec<KeepSegment>, String> {
    if segments.is_empty() {
        return Err("nothing to keep".into());
    }
    let mut v = segments.to_vec();
    v.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
    let mut prev_end = 0.0;
    for (i, s) in v.iter().enumerate() {
        // Reject empty/inverted regions AND NaN (partial_cmp is None for NaN → rejected).
        if !matches!(s.end.partial_cmp(&s.start), Some(std::cmp::Ordering::Greater)) {
            return Err("empty keep-region".into());
        }
        if s.start < -1e-6 || s.end > duration + 1e-3 {
            return Err("keep-region out of bounds".into());
        }
        if i > 0 && s.start < prev_end - 1e-6 {
            return Err("overlapping keep-regions".into());
        }
        // NaN fails both comparisons → rejected.
        if !(s.speed >= 0.5 - 1e-9 && s.speed <= 2.0 + 1e-9) {
            return Err("speed out of range".into());
        }
        prev_end = s.end;
    }
    Ok(v)
}

/// True when the edit changes nothing: a single full-span segment at speed 1 with no fades.
pub fn is_noop(segments: &[KeepSegment], duration: f64, fade_in: f64, fade_out: f64) -> bool {
    segments.len() == 1
        && segments[0].start <= 1e-3
        && segments[0].end >= duration - 0.05
        && (segments[0].speed - 1.0).abs() < 1e-9
        && fade_in <= 1e-9
        && fade_out <= 1e-9
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

/// Build ffmpeg args for a per-segment trim: trim each kept segment (applying its speed),
/// concat them in one re-encode pass, then optionally fade the concatenated output in/out.
/// `segments` is already validated (sorted, non-overlapping, in-bounds, speed∈[0.5,2]).
/// A speed-1 segment emits the plain `setpts=PTS-STARTPTS`; with both fades 0 the concat
/// writes `[outv]`/`[outa]` directly (byte-identical to the pre-speed/fade path).
pub fn build_trim_args(
    input: &str,
    output: &str,
    segments: &[KeepSegment],
    has_audio: bool,
    fade_in: f64,
    fade_out: f64,
) -> Vec<String> {
    // Format a number without a trailing ".0" (so 1.5 -> "1.5", 3.0 -> "3").
    fn num(n: f64) -> String {
        if n.fract() == 0.0 { format!("{}", n as i64) } else { format!("{n}") }
    }
    let one = |k: f64| (k - 1.0).abs() < 1e-9;

    let mut fc = String::new();
    for (i, s) in segments.iter().enumerate() {
        if one(s.speed) {
            fc.push_str(&format!("[0:v]trim={}:{},setpts=PTS-STARTPTS[v{i}];", num(s.start), num(s.end)));
        } else {
            fc.push_str(&format!("[0:v]trim={}:{},setpts=(PTS-STARTPTS)/{}[v{i}];", num(s.start), num(s.end), num(s.speed)));
        }
        if has_audio {
            if one(s.speed) {
                fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS[a{i}];", num(s.start), num(s.end)));
            } else {
                fc.push_str(&format!("[0:a]atrim={}:{},asetpts=PTS-STARTPTS,atempo={}[a{i}];", num(s.start), num(s.end), num(s.speed)));
            }
        }
    }
    let n = segments.len();
    for i in 0..n {
        fc.push_str(&format!("[v{i}]"));
        if has_audio { fc.push_str(&format!("[a{i}]")); }
    }

    // Fades post-process the concat output; with no fades, concat writes [outv]/[outa]
    // directly (byte-identical to the pre-fade path).
    let apply_fade = fade_in > 1e-9 || fade_out > 1e-9;
    let (vlabel, alabel) = if apply_fade { ("cv", "ca") } else { ("outv", "outa") };
    if has_audio {
        fc.push_str(&format!("concat=n={n}:v=1:a=1[{vlabel}][{alabel}]"));
    } else {
        fc.push_str(&format!("concat=n={n}:v=1:a=0[{vlabel}]"));
    }
    if apply_fade {
        let out_dur = output_duration(segments);
        let st = (out_dur - fade_out).max(0.0);
        let mut vf = String::new();
        if fade_in > 1e-9 { vf.push_str(&format!("fade=t=in:st=0:d={}", num(fade_in))); }
        if fade_out > 1e-9 {
            if !vf.is_empty() { vf.push(','); }
            vf.push_str(&format!("fade=t=out:st={}:d={}", num(st), num(fade_out)));
        }
        fc.push_str(&format!(";[cv]{vf}[outv]"));
        if has_audio {
            let mut af = String::new();
            if fade_in > 1e-9 { af.push_str(&format!("afade=t=in:st=0:d={}", num(fade_in))); }
            if fade_out > 1e-9 {
                if !af.is_empty() { af.push(','); }
                af.push_str(&format!("afade=t=out:st={}:d={}", num(st), num(fade_out)));
            }
            fc.push_str(&format!(";[ca]{af}[outa]"));
        }
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

/// Extract a downsampled mono waveform for the timeline. Runs ffmpeg to decode audio to
/// mono s16le @ 8 kHz, then buckets it. Any failure (no audio track, ffmpeg error) → Err;
/// the frontend treats that as "no waveform" and renders the timeline without it.
#[tauri::command(async)]
pub async fn recorder_trim_waveform(
    app: tauri::AppHandle,
    path: String,
    buckets: u32,
) -> Result<Vec<f32>, String> {
    let sidecar = app.shell().sidecar("ffmpeg").map_err(|e| format!("ffmpeg resolve: {e}"))?;
    let out = sidecar
        .args([
            "-v", "error",
            "-i", &path,
            "-map", "0:a:0",
            "-ac", "1",
            "-ar", "8000",
            "-f", "s16le",
            "-",
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg run: {e}"))?;
    if !out.status.success() {
        return Err("no audio / ffmpeg failed".into());
    }
    Ok(peaks_from_pcm_s16le(&out.stdout, buckets as usize))
}

/// Video source extensions accepted for "Open in Glint" → trim. Matches the Windows
/// `video` perceived type the shell verb registers under.
pub const VIDEO_EXTS: [&str; 7] = ["mp4", "mov", "mkv", "webm", "avi", "m4v", "wmv"];

/// True if `path` ends with a supported video extension (case-insensitive).
pub fn is_video_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    VIDEO_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
}

/// The first argv entry pointing at an existing file with a supported video extension.
/// Pure (no app handle) so it's unit-testable; used by the cold-start argv parse and the
/// warm-start single-instance callback to route a video to the trim window.
pub fn first_video_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| is_video_path(a) && std::path::Path::new(a).is_file())
        .cloned()
}

/// Export the trimmed recording in one ffmpeg pass. Always encodes to a temp file
/// first, then commits per `mode` ("copy" | "overwrite"). The original is never at
/// risk mid-encode: on overwrite it is moved aside and only removed once the new file
/// is safely in place; any failure rolls back and leaves the original intact. Async —
/// it spawns the sidecar and continuously drains the (capacity-1) progress channel.
// Retained: arity is intrinsic to a Tauri command — each arg is a distinct IPC
// field the frontend passes; a params struct would only move the same fields
// behind one more (de)serialization hop.
#[allow(clippy::too_many_arguments)]
#[tauri::command(async)]
pub async fn recorder_trim_export(
    app: tauri::AppHandle,
    id: i64,
    src_path: String,
    segments: Vec<KeepSegment>,
    has_audio: bool,
    duration: f64,
    width: i64,
    height: i64,
    fade_in: f64,
    fade_out: f64,
    mode: String,
) -> Result<(), String> {
    let segments = validate_segments(&segments, duration)?;
    if is_noop(&segments, duration, fade_in, fade_out) {
        return Err("no changes to save".into());
    }
    let total_out: f64 = output_duration(&segments);

    let src = PathBuf::from(&src_path);
    let final_path = if mode == "overwrite" { src.clone() } else { trimmed_output_path(&src) };
    let tmp = src.with_extension("trimtmp.mp4");
    let tmp_str = tmp.to_string_lossy().to_string();
    let _ = std::fs::remove_file(&tmp); // clear any stale temp from a prior failed run

    let args = build_trim_args(&src_path, &tmp_str, &segments, has_audio, fade_in, fade_out);
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
                            let pct = ((us / 1_000_000.0) / total_out.max(0.001) * 100.0).clamp(0.0, 100.0);
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
            // id < 0 == an external file with no Library row (opened via Explorer) — the
            // file is replaced in place, there's just no row to refresh.
            if id >= 0 {
                let _ = crate::db::update_capture_file(&conn, id, bytes, thumb.as_deref(), w, h);
            }
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
    fn is_video_path_matches_known_extensions_case_insensitive() {
        assert!(is_video_path(r"C:\clips\demo.mp4"));
        assert!(is_video_path(r"C:\clips\DEMO.MOV"));
        assert!(is_video_path("a.webm"));
        assert!(!is_video_path(r"C:\pics\shot.png"));
        assert!(!is_video_path(r"C:\notes.txt"));
        assert!(!is_video_path("noext"));
    }

    #[test]
    fn first_video_arg_ignores_nonvideo_and_missing_files() {
        // A .png is never a video, and a non-existent .mp4 doesn't pass the is_file check.
        let args = vec!["glint.exe".to_string(), r"C:\pics\shot.png".to_string(), r"C:\nope_missing_xyz.mp4".to_string()];
        assert_eq!(first_video_arg(&args), None);
    }

    fn seg(start: f64, end: f64, speed: f64) -> KeepSegment { KeepSegment { start, end, speed } }

    #[test]
    fn video_only_two_regions_concat() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 1.5, 1.0), seg(3.0, 4.0, 1.0)], false, 0.0, 0.0);
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
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 2.0, 1.0), seg(5.0, 6.5, 1.0)], true, 0.0, 0.0);
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
    fn speed_segment_divides_video_pts_and_atempos_audio() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 4.0, 2.0)], true, 0.0, 0.0);
        let fc = "[0:v]trim=0:4,setpts=(PTS-STARTPTS)/2[v0];\
                  [0:a]atrim=0:4,asetpts=PTS-STARTPTS,atempo=2[a0];\
                  [v0][a0]concat=n=1:v=1:a=1[outv][outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
    }

    #[test]
    fn speed_one_is_byte_identical_to_plain_trim() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(2.0, 8.0, 1.0)], false, 0.0, 0.0);
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex"
            && w[1] == "[0:v]trim=2:8,setpts=PTS-STARTPTS[v0];[v0]concat=n=1:v=1:a=0[outv]"), "got {a:?}");
    }

    #[test]
    fn fades_post_process_the_concat_output() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 10.0, 1.0)], true, 1.0, 2.0);
        let fc = "[0:v]trim=0:10,setpts=PTS-STARTPTS[v0];\
                  [0:a]atrim=0:10,asetpts=PTS-STARTPTS[a0];\
                  [v0][a0]concat=n=1:v=1:a=1[cv][ca];\
                  [cv]fade=t=in:st=0:d=1,fade=t=out:st=8:d=2[outv];\
                  [ca]afade=t=in:st=0:d=1,afade=t=out:st=8:d=2[outa]";
        assert!(a.windows(2).any(|w| w[0] == "-filter_complex" && w[1] == fc), "got {a:?}");
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outv]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[outa]"));
    }

    #[test]
    fn fade_out_start_is_speed_aware() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 4.0, 2.0), seg(10.0, 14.0, 1.0)], false, 0.0, 1.0);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("fade=t=out:st=5:d=1"), "got {fc}");
    }

    #[test]
    fn args_silence_stderr_and_progress() {
        let a = build_trim_args("in.mp4", "out.mp4", &[seg(0.0, 1.0, 1.0)], false, 0.0, 0.0);
        assert!(a.iter().any(|s| s == "-nostats"));
        assert!(a.windows(2).any(|w| w[0] == "-loglevel" && w[1] == "error"));
        assert!(a.windows(2).any(|w| w[0] == "-progress" && w[1] == "pipe:1"));
        assert!(a.iter().any(|s| s == "-y"));
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert!(a.windows(2).any(|w| w[0] == "-movflags" && w[1] == "+faststart"));
    }

    #[test]
    fn output_duration_is_speed_weighted() {
        let d = output_duration(&[seg(0.0, 4.0, 2.0), seg(10.0, 16.0, 1.0)]);
        assert!((d - (2.0 + 6.0)).abs() < 1e-9, "got {d}");
    }

    #[test]
    fn peaks_bucket_max_abs_normalized() {
        // 4 samples (i16le): 0, 16384(=0.5), -32768(=1.0), 8192(=0.25) → 2 buckets.
        let mut bytes = Vec::new();
        for v in [0i16, 16384, -32768, 8192] { bytes.extend_from_slice(&v.to_le_bytes()); }
        let p = peaks_from_pcm_s16le(&bytes, 2);
        assert_eq!(p.len(), 2);
        assert!((p[0] - 0.5).abs() < 1e-3, "bucket0 = {}", p[0]);  // max(|0|,|0.5|)
        assert!((p[1] - 1.0).abs() < 1e-3, "bucket1 = {}", p[1]);  // max(|1.0|,|0.25|)
    }

    #[test]
    fn peaks_empty_input_is_zeros() {
        assert_eq!(peaks_from_pcm_s16le(&[], 3), vec![0.0, 0.0, 0.0]);
    }

    #[test]
    fn peaks_zero_buckets_is_empty() {
        assert!(peaks_from_pcm_s16le(&[0, 0, 0, 0], 0).is_empty());
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
        assert!(p.has_audio);
        assert!((p.duration_secs - 12.5).abs() < 1e-6);
        assert!((p.fps - 30.0).abs() < 1e-6);
    }

    #[test]
    fn parses_video_only_no_audio() {
        let json = r#"{"streams":[{"codec_type":"video","width":1280,"height":720,"avg_frame_rate":"60/1"}],"format":{"duration":"3.0"}}"#;
        let p = parse_ffprobe_json(json).unwrap();
        assert!(!p.has_audio);
        assert!((p.fps - 60.0).abs() < 1e-6);
    }

    #[test]
    fn validate_sorts_rejects_overlap_oob_and_bad_speed() {
        assert_eq!(
            validate_segments(&[seg(3.0, 4.0, 1.0), seg(0.0, 1.0, 2.0)], 10.0).unwrap(),
            vec![seg(0.0, 1.0, 2.0), seg(3.0, 4.0, 1.0)]
        );
        assert!(validate_segments(&[seg(0.0, 2.0, 1.0), seg(1.0, 3.0, 1.0)], 10.0).is_err()); // overlap
        assert!(validate_segments(&[seg(0.0, 11.0, 1.0)], 10.0).is_err());                    // oob
        assert!(validate_segments(&[seg(2.0, 2.0, 1.0)], 10.0).is_err());                     // empty
        assert!(validate_segments(&[], 10.0).is_err());                                       // empty list
        assert!(validate_segments(&[seg(0.0, 5.0, 3.0)], 10.0).is_err());                     // speed too high
        assert!(validate_segments(&[seg(0.0, 5.0, 0.25)], 10.0).is_err());                    // speed too low
    }

    #[test]
    fn noop_only_when_full_span_speed1_no_fades() {
        assert!(is_noop(&[seg(0.0, 10.0, 1.0)], 10.0, 0.0, 0.0));
        assert!(!is_noop(&[seg(0.0, 10.0, 2.0)], 10.0, 0.0, 0.0));  // speed change is an edit
        assert!(!is_noop(&[seg(0.0, 10.0, 1.0)], 10.0, 0.5, 0.0));  // fade is an edit
        assert!(!is_noop(&[seg(0.0, 5.0, 1.0)], 10.0, 0.0, 0.0));   // a cut
    }

    #[test]
    fn trimmed_name_appends_suffix_and_counter() {
        use std::path::Path;
        // Base case appends " (trimmed)" before the extension.
        let p = trimmed_output_path(Path::new("C:/x/Glint 2026 at 10.00.00.mp4"));
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "Glint 2026 at 10.00.00 (trimmed).mp4");
    }
}
