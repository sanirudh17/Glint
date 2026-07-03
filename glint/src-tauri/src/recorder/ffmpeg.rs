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
    /// Microphone (vs system loopback) — gets a light voice EQ before mixing.
    pub is_mic: bool,
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
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str, audio: &[AudioInput], want_audio: bool, draw_mouse: bool) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
        "-f".into(), "gdigrab".into(),
        "-framerate".into(), fps.to_string(),
    ];
    if !draw_mouse {
        // Hide the OS cursor in the capture; the FX overlay draws our own pointer.
        a.extend(["-draw_mouse".into(), "0".into()]);
    }
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
    // Voice cleanup applied to the MIC only (system audio passes through clean):
    //  • pan=stereo|c0=c0|c1=c0 — collapse to dual-mono from the left channel, so a
    //    mono mic that Windows presents as fake-stereo can't sound hollow/phasey and
    //    the result is mono-compatible.
    //  • highpass 80 Hz — de-rumble.
    //  • -2 dB bell @ 400 Hz — reduce boxiness ("hollow").
    //  • +3 dB bell @ 3.5 kHz — presence/clarity.
    const MIC_FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=400:width_type=o:width=1.4:g=-2,equalizer=f=3500:width_type=o:width=1.4:g=3";
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
            1 => {
                let fx = if audio[0].is_mic { format!(",{MIC_FX}") } else { String::new() };
                audio_tail(&mut a, format!("[1:a]aresample=async=1{fx},{AFMT}[aout]"));
            }
            n => {
                // Pre-filter mic inputs (voice EQ); system inputs pass straight in.
                // normalize=0: don't scale each input by 1/N (the default), which
                // halves a source's volume — thin/quiet mic and system. Since the
                // unselected source is muted (silence), summing at full level keeps
                // the active source(s) at their true loudness.
                let mut chains = String::new();
                let mut labels = String::new();
                for (idx, ai) in audio.iter().enumerate() {
                    let i = idx + 1;
                    if ai.is_mic {
                        chains.push_str(&format!("[{i}:a]{MIC_FX}[m{i}];"));
                        labels.push_str(&format!("[m{i}]"));
                    } else {
                        labels.push_str(&format!("[{i}:a]"));
                    }
                }
                audio_tail(&mut a, format!("{chains}{labels}amix=inputs={n}:duration=longest:normalize=0,aresample=async=1,{AFMT}[aout]"));
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
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
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
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, true);
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
    fn framerate_arg_follows_fps() {
        let a30 = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "out.mp4", &[], false, true);
        let a60 = build_ffmpeg_args(&RecordTarget::Fullscreen, 60, "out.mp4", &[], false, true);
        let fr = |a: &[String]| a.windows(2).find(|w| w[0] == "-framerate").map(|w| w[1].clone());
        assert_eq!(fr(&a30).as_deref(), Some("30"));
        assert_eq!(fr(&a60).as_deref(), Some("60"));
    }

    #[test]
    fn region_args_carry_offset_and_size() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(&t, 30, "C:/r.mp4", &[], false, true);
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
    }

    #[test]
    fn draw_mouse_off_inserts_flag() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, false);
        // -draw_mouse 0 is a gdigrab input option: it must appear after "gdigrab"
        // and before the "-i desktop" input.
        let g = a.iter().position(|s| s == "gdigrab").unwrap();
        let dm = a.iter().position(|s| s == "-draw_mouse").expect("draw_mouse present");
        let input = a.iter().position(|s| s == "desktop").unwrap();
        assert_eq!(a[dm + 1], "0");
        assert!(g < dm && dm < input, "draw_mouse must sit between gdigrab and -i");
    }

    #[test]
    fn draw_mouse_on_omits_flag() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, true);
        assert!(!a.iter().any(|s| s == "-draw_mouse"));
    }

    fn ai(rate: u32) -> AudioInput {
        AudioInput { pipe_path: format!("\\\\.\\pipe\\glint-{rate}"), sample_rate: rate, channels: 2, is_mic: false }
    }
    fn ai_mic(rate: u32) -> AudioInput {
        AudioInput { pipe_path: format!("\\\\.\\pipe\\glint-mic-{rate}"), sample_rate: rate, channels: 2, is_mic: true }
    }

    #[test]
    fn no_audio_is_identical_to_silent_video() {
        // No audio wanted → pure video, no aac stream, no filter, no silent pad.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
        assert!(!v.iter().any(|s| s == "-c:a"));
        assert!(!v.iter().any(|s| s == "-filter_complex"));
        assert!(!v.iter().any(|s| s.contains("anullsrc")));
        assert_eq!(v.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn one_source_maps_directly_no_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true, true);
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
    fn mic_gets_voice_eq_system_does_not() {
        const FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=400:width_type=o:width=1.4:g=-2,equalizer=f=3500:width_type=o:width=1.4:g=3";
        // Single mic source: cleanup inline before the format normalize.
        let m = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai_mic(48000)], true, true);
        assert!(m.iter().any(|s| *s == format!("[1:a]aresample=async=1,{FX},aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
        // System (input 1) passes through; mic (input 2) is pre-filtered then mixed.
        let both = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai_mic(48000)], true, true);
        assert!(both.iter().any(|s| *s == format!("[2:a]{FX}[m2];[1:a][m2]amix=inputs=2:duration=longest:normalize=0,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
    }

    #[test]
    fn two_sources_use_amix() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai(44100)], true, true);
        assert!(v.iter().any(|s| s == "[1:a][2:a]amix=inputs=2:duration=longest:normalize=0,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        // both rates present as input options
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "44100"));
    }

    #[test]
    fn audio_inputs_carry_thread_queue_size() {
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true, true);
        assert!(v.windows(2).any(|w| w[0] == "-thread_queue_size" && w[1] == "1024"));
    }

    #[test]
    fn want_audio_with_no_sources_injects_silent_aac() {
        // Audio wanted but no source connected this segment → a silent anullsrc track
        // keeps the segment's stream layout (video + 1 aac) homogeneous for concat-copy.
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], true, true);
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
        let v = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
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
