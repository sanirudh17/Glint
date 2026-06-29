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
/// `want_audio` is whether THIS recording requested any audio at all (system or
/// mic enabled at start), independent of how many sources actually connected for
/// this segment. It matters for pause/resume: segments are concatenated with
/// `-c copy`, which demands an identical stream layout across every segment. If a
/// source connects in one segment but fails in a later (resumed) one, a video-only
/// segment would be mixed with audio-bearing ones and the whole concat would fail
/// — losing the entire recording. So when audio was wanted we guarantee every
/// segment carries exactly one aac stream: real sources are normalized to a
/// canonical format, and a segment with zero connected sources gets a silent
/// `anullsrc` track in that same format. All segments' aac is then concat-compatible.
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput], want_audio: bool) -> Vec<String> {
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
            // Stamp each PCM chunk with the wall-clock time ffmpeg reads it so the
            // audio shares gdigrab's wall clock; `aresample=async=1` below then aligns
            // the two (padding a little leading silence if audio starts a touch after
            // the first video frame). Without this, raw f32le is stamped from sample 0
            // and the audio rides ahead of the video.
            "-use_wallclock_as_timestamps".into(), "1".into(),
            "-f".into(), "f32le".into(),
            "-ar".into(), ai.sample_rate.to_string(),
            "-ac".into(), ai.channels.to_string(),
            "-i".into(), ai.pipe_path.clone(),
        ]);
    }

    // No real source connected, but audio was wanted → inject a silent track so this
    // segment still produces an aac stream (concat-copy homogeneity, see fn doc).
    // anullsrc becomes input 1 and is pinned to the canonical output format below.
    let silent_pad = audio.is_empty() && want_audio;
    if silent_pad {
        a.extend([
            "-f".into(), "lavfi".into(),
            "-i".into(), "anullsrc=channel_layout=stereo:sample_rate=48000".into(),
        ]);
    }

    // Video codec (unchanged from R1).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio graph + explicit stream mapping. With extra inputs present, ffmpeg's
    // auto-map would guess; we map video from input 0 and the single audio output.
    // Every audio output is normalized to stereo/48 kHz (`AFMT`) so the aac params
    // are byte-for-byte identical across segments regardless of which/how many
    // sources connected — the invariant concat `-c copy` relies on.
    const AFMT: &str = "aformat=sample_rates=48000:channel_layouts=stereo";
    let audio_tail = |a: &mut Vec<String>, fc: String| {
        a.extend([
            "-filter_complex".into(), fc,
            "-map".into(), "0:v".into(),
            "-map".into(), "[aout]".into(),
            "-c:a".into(), "aac".into(),
            "-b:a".into(), "192k".into(),
        ]);
    };
    if silent_pad {
        audio_tail(&mut a, format!("[1:a]{AFMT}[aout]"));
    } else {
        match audio.len() {
            0 => {}
            1 => audio_tail(&mut a, format!("[1:a]aresample=async=1,{AFMT}[aout]")),
            n => {
                let labels: String = (1..=n).map(|i| format!("[{i}:a]")).collect();
                audio_tail(&mut a, format!("{labels}amix=inputs={n}:duration=longest,aresample=async=1,{AFMT}[aout]"));
            }
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
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false);
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
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false);
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
        let a = build_ffmpeg_args(&t, 30, "C:/r.mp4", &[], false);
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
    }

    fn ai(rate: u32) -> AudioInput {
        AudioInput { pipe_path: format!("\\\\.\\pipe\\glint-{rate}"), sample_rate: rate, channels: 2 }
    }

    #[test]
    fn no_audio_is_identical_to_silent_video() {
        // No audio wanted → pure video, no aac stream, no filter, no silent pad.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false);
        assert!(!v.iter().any(|s| s == "-c:a"));
        assert!(!v.iter().any(|s| s == "-filter_complex"));
        assert!(!v.iter().any(|s| s.contains("anullsrc")));
        assert_eq!(v.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn one_source_maps_directly_no_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true);
        // input 0 = video (desktop), input 1 = the pipe
        assert!(v.windows(2).any(|w| w[0] == "-f" && w[1] == "f32le"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.iter().any(|s| s == "-filter_complex"));
        // normalized to stereo/48k so segments concat-copy cleanly
        assert!(v.iter().any(|s| s == "[1:a]aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(!v.iter().any(|s| s.contains("amix")));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(v.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
    }

    #[test]
    fn two_sources_use_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai(44100)], true);
        assert!(v.iter().any(|s| s == "[1:a][2:a]amix=inputs=2:duration=longest,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        // both rates present as input options
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "44100"));
    }

    #[test]
    fn audio_inputs_carry_thread_queue_size() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true);
        assert!(v.windows(2).any(|w| w[0] == "-thread_queue_size" && w[1] == "1024"));
    }

    #[test]
    fn audio_inputs_use_wallclock_timestamps_for_av_sync() {
        // Without wall-clock stamping, raw f32le rides ahead of the gdigrab video.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true);
        assert!(v.windows(2).any(|w| w[0] == "-use_wallclock_as_timestamps" && w[1] == "1"));
    }

    #[test]
    fn want_audio_with_no_sources_injects_silent_aac() {
        // Audio wanted but no source connected this segment → a silent anullsrc track
        // keeps the segment's stream layout (video + 1 aac) homogeneous for concat-copy.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], true);
        assert!(v.windows(2).any(|w| w[0] == "-f" && w[1] == "lavfi"));
        assert!(v.iter().any(|s| s == "anullsrc=channel_layout=stereo:sample_rate=48000"));
        assert!(v.iter().any(|s| s == "[1:a]aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert!(v.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
        // no real pipe input
        assert!(!v.iter().any(|s| s == "f32le"));
    }

    #[test]
    fn no_silent_pad_when_audio_not_wanted() {
        // Empty audio + want_audio=false (no audio recording) must stay pure video.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false);
        assert!(!v.iter().any(|s| s.contains("anullsrc")));
        assert!(!v.iter().any(|s| s == "-c:a"));
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
