use crate::recorder::RecordTarget;

/// Round down to the nearest even number (yuv420p needs even width/height).
pub fn even(n: u32) -> u32 {
    n - (n % 2)
}

/// One ffmpeg audio input fed live from a Windows named pipe (raw f32le PCM).
pub struct AudioInput {
    pub pipe_path: String,
    pub sample_rate: u32,
    pub channels: u16,
}

/// Build the ffmpeg arg list: capture the screen via gdigrab and encode H.264 MP4.
/// `-preset ultrafast` keeps encoding real-time at 30 fps; `+faststart` + a clean
/// `q`-driven stop yield a seekable, playable file.
///
/// `-nostats -loglevel error` is load-bearing, not cosmetic: the sidecar's
/// stdout/stderr event channel has capacity 1 and we don't drain it while
/// recording (only on stop). ffmpeg streams a per-frame stats line to stderr by
/// default; with the channel full the reader thread parks, stops draining the
/// stderr pipe, and once the OS pipe buffer fills ffmpeg blocks on `write()` —
/// stalling the capture on long recordings. Keeping stderr quiet after startup
/// avoids that backpressure entirely.
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput]) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-f".into(), "gdigrab".into(),
        "-framerate".into(), fps.to_string(),
    ];
    if let RecordTarget::Region { x, y, w, h } = target {
        a.extend([
            "-offset_x".into(), x.to_string(),
            "-offset_y".into(), y.to_string(),
            "-video_size".into(), format!("{w}x{h}"),
        ]);
    }
    a.extend(["-i".into(), "desktop".into()]); // input 0 = video

    // Audio pipe inputs become input 1..=N (a generous thread_queue_size keeps the
    // live pipe from underrun-spamming ffmpeg).
    for ai in audio {
        a.extend([
            "-thread_queue_size".into(), "1024".into(),
            "-f".into(), "f32le".into(),
            "-ar".into(), ai.sample_rate.to_string(),
            "-ac".into(), ai.channels.to_string(),
            "-i".into(), ai.pipe_path.clone(),
        ]);
    }

    // Video codec (unchanged from R1).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio graph + explicit stream mapping. With extra inputs present, ffmpeg's
    // auto-map would guess; we map video from input 0 and the mixed audio output.
    match audio.len() {
        0 => {}
        1 => {
            a.extend([
                "-filter_complex".into(), "[1:a]aresample=async=1[aout]".into(),
                "-map".into(), "0:v".into(),
                "-map".into(), "[aout]".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "192k".into(),
            ]);
        }
        n => {
            let labels: String = (1..=n).map(|i| format!("[{i}:a]")).collect();
            let fc = format!("{labels}amix=inputs={n}:duration=longest,aresample=async=1[aout]");
            a.extend([
                "-filter_complex".into(), fc,
                "-map".into(), "0:v".into(),
                "-map".into(), "[aout]".into(),
                "-c:a".into(), "aac".into(),
                "-b:a".into(), "192k".into(),
            ]);
        }
    }

    a.extend(["-movflags".into(), "+faststart".into(), out.into()]);
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::RecordTarget;

    #[test]
    fn args_silence_stderr_to_avoid_pipe_backpressure() {
        // The undrained capacity-1 sidecar channel stalls ffmpeg if stderr is chatty;
        // these flags keep it quiet after startup. Guard against a regression.
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[]);
        assert!(a.iter().any(|s| s == "-nostats"));
        assert!(a.windows(2).any(|w| w[0] == "-loglevel" && w[1] == "error"));
    }

    #[test]
    fn even_rounds_down() {
        assert_eq!(even(1920), 1920);
        assert_eq!(even(1921), 1920);
        assert_eq!(even(1), 0);
    }

    #[test]
    fn fullscreen_args_have_no_offset() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[]);
        assert!(a.contains(&"gdigrab".to_string()));
        assert!(a.contains(&"desktop".to_string()));
        assert!(!a.iter().any(|s| s == "-offset_x"));
        // ends with the output path
        assert_eq!(a.last().unwrap(), "C:/out.mp4");
        // libx264 + yuv420p + faststart present
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
    }

    #[test]
    fn region_args_carry_offset_and_size() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(&t, 30, "C:/r.mp4", &[]);
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
    }

    fn ai(rate: u32) -> AudioInput {
        AudioInput { pipe_path: format!("\\\\.\\pipe\\glint-{rate}"), sample_rate: rate, channels: 2 }
    }

    #[test]
    fn no_audio_is_identical_to_silent_video() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[]);
        assert!(!v.iter().any(|s| s == "-c:a"));
        assert!(!v.iter().any(|s| s == "-filter_complex"));
        assert_eq!(v.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn one_source_maps_directly_no_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)]);
        // input 0 = video (desktop), input 1 = the pipe
        assert!(v.windows(2).any(|w| w[0] == "-f" && w[1] == "f32le"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.iter().any(|s| s == "-filter_complex"));
        assert!(v.iter().any(|s| s == "[1:a]aresample=async=1[aout]"));
        assert!(!v.iter().any(|s| s.contains("amix")));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(v.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
    }

    #[test]
    fn two_sources_use_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai(44100)]);
        assert!(v.iter().any(|s| s == "[1:a][2:a]amix=inputs=2:duration=longest,aresample=async=1[aout]"));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        // both rates present as input options
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "44100"));
    }

    #[test]
    fn audio_inputs_carry_thread_queue_size() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)]);
        assert!(v.windows(2).any(|w| w[0] == "-thread_queue_size" && w[1] == "1024"));
    }

    #[test]
    fn normalize_rejects_tiny_and_rounds_even() {
        assert!(super::super::normalize_region(0, 0, 10, 10).is_none());
        assert_eq!(super::super::normalize_region(5, 6, 641, 480), Some((5, 6, 640, 480)));
    }

    #[test]
    fn filename_format() {
        use chrono::TimeZone;
        let dt = chrono::Local.with_ymd_and_hms(2026, 6, 28, 14, 30, 5).unwrap();
        assert_eq!(super::super::recording_filename(dt), "Glint 2026-06-28 at 14.30.05.mp4");
    }
}
