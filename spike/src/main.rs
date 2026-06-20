//! Glint Phase 0 spike (THROWAWAY).
//!
//! Goal / gate: capture the primary monitor with `scap`, feed constant-frame-rate
//! BGRA frames to an `ffmpeg` sidecar over stdin, and write a smooth, in-sync
//! `spike.mp4` (H.264). Hardware encoder when available, software fallback.
//!
//! Pacing strategy: the desktop-duplication source only delivers a frame when the
//! screen changes, so we run capture on its own thread that keeps "the latest frame"
//! in a shared slot, and a steady writer that ticks at the target fps and duplicates
//! the last frame when nothing new arrived. That is what makes playback smooth and
//! keeps output duration == wall-clock duration.

use std::error::Error;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use scap::capturer::{Capturer, Options};
use scap::frame::{Frame, FrameType};

const TARGET_FPS: u32 = 30;
const RECORD_SECS: u64 = 12;

/// One captured frame: tightly packed BGRA (no row padding) plus its dimensions and a
/// monotonically increasing sequence number so the writer can tell "new" from "stale".
struct Latest {
    seq: u64,
    width: u32,
    height: u32,
    data: Arc<Vec<u8>>,
}

fn main() -> Result<(), Box<dyn Error>> {
    println!("== Glint Phase 0 spike: scap -> ffmpeg -> MP4 ==");

    if !scap::is_supported() {
        return Err("scap reports screen capture is NOT supported on this platform".into());
    }
    if !scap::has_permission() {
        // On Windows this is essentially always granted; request just in case.
        if !scap::request_permission() {
            return Err("screen capture permission not granted".into());
        }
    }

    let encoder = pick_encoder()?;
    println!("ffmpeg encoder selected: {encoder}");

    // ---- shared state between the capture (main) thread and the writer thread ----
    // `Capturer` holds an HWND and is NOT Send, so capture must stay on the main
    // thread. The writer thread only ever touches `Arc`-shared buffers, which are Send.
    let latest: Arc<Mutex<Option<Latest>>> = Arc::new(Mutex::new(None));
    let captured = Arc::new(AtomicU64::new(0));
    let stop = Arc::new(AtomicBool::new(false));

    // ---- writer thread: ffmpeg sidecar + constant-frame-rate pacing ----
    let w_latest = Arc::clone(&latest);
    let w_captured = Arc::clone(&captured);
    let w_stop = Arc::clone(&stop);
    let writer = thread::spawn(move || {
        let res = run_writer(&w_latest, &w_captured, encoder);
        w_stop.store(true, Ordering::Relaxed); // always release the capture loop
        res
    });

    // ---- capture loop (main thread) ----
    let mut capturer = Capturer::build(Options {
        fps: TARGET_FPS,
        show_cursor: true,
        show_highlight: false,
        target: None, // primary display
        crop_area: None,
        output_type: FrameType::BGRAFrame,
        output_resolution: scap::capturer::Resolution::Captured,
        excluded_targets: None,
    })?;
    capturer.start_capture();
    let mut seq = 0u64;
    loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match capturer.get_next_frame() {
            Ok(Frame::BGRA(f)) => {
                let w = f.width.max(0) as u32;
                let h = f.height.max(0) as u32;
                if w == 0 || h == 0 {
                    continue;
                }
                let packed = pack_bgra(&f.data, w as usize, h as usize);
                seq += 1;
                *latest.lock().unwrap() = Some(Latest {
                    seq,
                    width: w,
                    height: h,
                    data: Arc::new(packed),
                });
                captured.fetch_add(1, Ordering::Relaxed);
            }
            Ok(_) => {}        // we requested BGRA; ignore anything else
            Err(_) => break,   // channel closed
        }
    }
    capturer.stop_capture();

    match writer.join() {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e.into()),
        Err(_) => Err("writer thread panicked".into()),
    }
}

/// Runs on the writer thread: spawn ffmpeg, pace frames at a constant rate, finalize,
/// and report the gate result. Returns an error string on any failure.
fn run_writer(
    latest: &Arc<Mutex<Option<Latest>>>,
    captured: &Arc<AtomicU64>,
    encoder: Encoder,
) -> Result<(), String> {
    // wait for the first frame so we know the canonical WxH for ffmpeg
    let (width, height) = wait_for_first_frame(latest, Duration::from_secs(5))
        .ok_or("no frame captured within 5s — capture path is not delivering frames")?;
    println!("capture size: {width}x{height} @ {TARGET_FPS}fps for {RECORD_SECS}s");

    let mut ffmpeg = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            // raw input from stdin
            "-f", "rawvideo",
            "-pix_fmt", "bgra",
            "-s", &format!("{width}x{height}"),
            "-r", &TARGET_FPS.to_string(),
            "-i", "-",
        ])
        .args(encoder.ffmpeg_args())
        .args([
            "-pix_fmt", "yuv420p",
            "-r", &TARGET_FPS.to_string(),
            "-movflags", "+faststart",
            "spike.mp4",
        ])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to launch ffmpeg (is it on PATH?): {e}"))?;
    let mut ffmpeg_stdin = ffmpeg.stdin.take().expect("ffmpeg stdin piped");

    let total_frames = TARGET_FPS as u64 * RECORD_SECS;
    let frame_period = Duration::from_secs_f64(1.0 / TARGET_FPS as f64);
    let expected_len = (width as usize) * (height as usize) * 4;

    let start = Instant::now();
    let mut last_seq = 0u64;
    let mut duplicates = 0u64;
    let mut last_data: Option<Arc<Vec<u8>>> = None;

    for i in 0..total_frames {
        // hold the steady cadence: sleep until this frame's scheduled time
        let target = start + frame_period * i as u32;
        if let Some(d) = target.checked_duration_since(Instant::now()) {
            thread::sleep(d);
        }

        // grab the newest frame (or reuse the previous one to hold CFR)
        let frame = {
            let guard = latest.lock().unwrap();
            match guard.as_ref() {
                Some(l) if l.width == width && l.height == height => {
                    if l.seq == last_seq {
                        duplicates += 1;
                    }
                    last_seq = l.seq;
                    Some(Arc::clone(&l.data))
                }
                _ => None,
            }
        };
        let frame = frame.or_else(|| last_data.clone());
        let Some(data) = frame else {
            duplicates += 1;
            continue;
        };

        if data.len() == expected_len {
            if ffmpeg_stdin.write_all(&data).is_err() {
                eprintln!("ffmpeg closed stdin early at frame {i}");
                break;
            }
            last_data = Some(data);
        }
    }

    drop(ffmpeg_stdin); // EOF -> ffmpeg finalizes the file
    let wall = start.elapsed().as_secs_f64();

    let status = ffmpeg.wait().map_err(|e| format!("waiting on ffmpeg: {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg exited with status {status}"));
    }

    let captured_n = captured.load(Ordering::Relaxed);
    let probed = probe_duration("spike.mp4");

    println!("\n== RESULT ==");
    println!("encoder used:      {encoder}");
    println!("frames captured:   {captured_n}  (real frames from scap)");
    println!("frames written:    {total_frames}  (duplicated to hold CFR: {duplicates})");
    println!("wall-clock:        {wall:.2}s");
    match probed {
        Some(d) => {
            let drift = (d - RECORD_SECS as f64).abs() / RECORD_SECS as f64 * 100.0;
            println!("spike.mp4 duration:{d:.2}s  (target {RECORD_SECS}s, drift {drift:.2}%)");
            println!(
                "\nGATE: {}",
                if drift <= 2.0 {
                    "PASS — open spike.mp4 and confirm motion is smooth"
                } else {
                    "CHECK — duration drift high; inspect pacing"
                }
            );
        }
        None => println!("spike.mp4 written (install ffprobe to auto-check duration)"),
    }

    Ok(())
}

/// Copy a (possibly stride-padded) BGRA buffer into a tightly packed `width*height*4`
/// buffer. The Windows full-display path hands back the raw GPU buffer whose row pitch
/// can exceed `width*4`, which ffmpeg's rawvideo demuxer would otherwise misread.
fn pack_bgra(data: &[u8], width: usize, height: usize) -> Vec<u8> {
    let row = width * 4;
    if height == 0 {
        return Vec::new();
    }
    let stride = data.len() / height;
    if stride == row {
        return data.to_vec();
    }
    let mut out = vec![0u8; row * height];
    for y in 0..height {
        let src = y * stride;
        if src + row <= data.len() {
            out[y * row..(y + 1) * row].copy_from_slice(&data[src..src + row]);
        }
    }
    out
}

fn wait_for_first_frame(
    latest: &Arc<Mutex<Option<Latest>>>,
    timeout: Duration,
) -> Option<(u32, u32)> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Some(l) = latest.lock().unwrap().as_ref() {
            return Some((l.width, l.height));
        }
        thread::sleep(Duration::from_millis(10));
    }
    None
}

/// H.264 encoder choices, in preference order. Hardware first, software last.
#[derive(Clone, Copy)]
enum Encoder {
    Nvenc,
    Qsv,
    Amf,
    Libx264,
}

impl Encoder {
    fn ffmpeg_args(self) -> Vec<&'static str> {
        match self {
            Encoder::Nvenc => vec!["-c:v", "h264_nvenc", "-preset", "p4", "-rc", "vbr", "-cq", "23"],
            Encoder::Qsv => vec!["-c:v", "h264_qsv", "-global_quality", "23"],
            Encoder::Amf => vec!["-c:v", "h264_amf", "-quality", "balanced"],
            Encoder::Libx264 => vec!["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"],
        }
    }
}

impl std::fmt::Display for Encoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Encoder::Nvenc => "h264_nvenc (NVIDIA)",
            Encoder::Qsv => "h264_qsv (Intel QSV)",
            Encoder::Amf => "h264_amf (AMD)",
            Encoder::Libx264 => "libx264 (software)",
        };
        f.write_str(s)
    }
}

/// Ask ffmpeg which encoders it has compiled in, then pick the best available.
fn pick_encoder() -> Result<Encoder, Box<dyn Error>> {
    let out = Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("could not run ffmpeg (is it on PATH?): {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let has = |name: &str| text.contains(name);
    Ok(if has("h264_nvenc") {
        Encoder::Nvenc
    } else if has("h264_qsv") {
        Encoder::Qsv
    } else if has("h264_amf") {
        Encoder::Amf
    } else {
        Encoder::Libx264
    })
}

/// Best-effort: read the encoded file's real duration with ffprobe.
fn probe_duration(path: &str) -> Option<f64> {
    let out = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse::<f64>().ok()
}
