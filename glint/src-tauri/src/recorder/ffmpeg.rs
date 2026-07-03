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

/// Which desktop-capture engine ffmpeg uses. `Ddagrab` (D3D11/GPU, true 60 fps) is
/// preferred; `Gdigrab` (GDI/CPU) is the fallback for setups where DDA can't init.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureEngine {
    Gdigrab,
    Ddagrab,
}

/// Build the ffmpeg arg list: capture the screen (via the chosen `engine`) and encode
/// H.264 MP4. `-preset ultrafast` keeps encoding real-time; `+faststart` + a clean
/// `q`-driven stop yield a seekable, playable file.
///
/// `gdigrab` is a real input (input 0), so audio pipes start at input 1 (`[1:a]`).
/// `ddagrab` is a *source filter* (no `-i` for video) whose D3D11 frames are pulled to
/// system memory via `hwdownload,format=bgra` and labelled `[v]`; audio pipes then start
/// at input 0 (`[0:a]`). The ddagrab video chain and the audio graph are combined into a
/// single `-filter_complex`. The libx264/yuv420p/faststart encode tail is identical for
/// both engines, so segments stay concat-copy compatible regardless of engine (the engine
/// is fixed for a whole recording).
///
/// `-nostats -loglevel error` is load-bearing, not cosmetic: the sidecar's stdout/stderr
/// event channel has capacity 1 and we don't drain it while recording (only on stop).
/// ffmpeg streams a per-frame stats line to stderr by default; with the channel full the
/// reader thread parks, stops draining the stderr pipe, and once the OS pipe buffer fills
/// ffmpeg blocks on `write()` — stalling the capture on long recordings. Keeping stderr
/// quiet after startup avoids that backpressure entirely.
///
/// `want_audio` is whether THIS recording requested any audio at all (system or mic
/// enabled at start), independent of how many sources actually connected for this
/// segment. It matters for pause/resume: segments are concatenated with `-c copy`, which
/// demands an identical stream layout across every segment. So when audio was wanted we
/// guarantee every segment carries exactly one aac stream: real sources are normalized to
/// a canonical format, and a segment with zero connected sources gets a silent `anullsrc`
/// track in that same format. All segments' aac is then concat-compatible.
pub fn build_ffmpeg_args(
    engine: CaptureEngine,
    target: &RecordTarget,
    fps: u32,
    out: &str,
    audio: &[AudioInput],
    want_audio: bool,
    draw_mouse: bool,
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-y".into(),
        "-nostats".into(),
        "-loglevel".into(), "error".into(),
    ];

    // Video input flags + the index of the first audio input. gdigrab is a real input
    // (0) → audio starts at 1. ddagrab is a filter SOURCE (no -i) → audio starts at 0.
    let audio_base: usize = match engine {
        CaptureEngine::Gdigrab => {
            a.extend(["-f".into(), "gdigrab".into(), "-framerate".into(), fps.to_string()]);
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
            1
        }
        CaptureEngine::Ddagrab => {
            a.extend(["-init_hw_device".into(), "d3d11va".into()]);
            0
        }
    };

    // Audio pipe inputs (input `audio_base`..). A generous thread_queue_size keeps the
    // live pipe from underrun-spamming ffmpeg.
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
    // segment still produces an aac stream (concat-copy homogeneity, see fn doc). The
    // anullsrc becomes the input at `audio_base` and is pinned to the canonical format.
    let silent_pad = audio.is_empty() && want_audio;
    if silent_pad {
        a.extend([
            "-f".into(), "lavfi".into(),
            "-i".into(), "anullsrc=channel_layout=stereo:sample_rate=48000".into(),
        ]);
    }

    // ddagrab video chain: source filter → system-memory bgra → [v]. draw_mouse is a
    // ddagrab option here; the FX overlay (a composed layered window) is captured either
    // way, so with draw_mouse=0 our own pointer still shows.
    let ddagrab_vchain = match engine {
        CaptureEngine::Ddagrab => {
            let mut src = format!(
                "ddagrab=output_idx=0:draw_mouse={}:framerate={}",
                if draw_mouse { 1 } else { 0 },
                fps
            );
            if let RecordTarget::Region { x, y, w, h } = target {
                src.push_str(&format!(":video_size={w}x{h}:offset_x={x}:offset_y={y}"));
            }
            Some(format!("{src},hwdownload,format=bgra[v]"))
        }
        CaptureEngine::Gdigrab => None,
    };

    // Video codec (identical across engines → concat-copy safe).
    a.extend([
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
    ]);

    // Audio filter graph producing [aout], or None. Input indices use `audio_base`.
    let audio_fc = audio_graph(audio, silent_pad, audio_base);
    let has_audio = audio_fc.is_some();

    // Combine video (ddagrab) + audio graphs into one -filter_complex, and map.
    match (ddagrab_vchain, audio_fc) {
        (Some(v), Some(af)) => a.extend([
            "-filter_complex".into(), format!("{v};{af}"),
            "-map".into(), "[v]".into(),
            "-map".into(), "[aout]".into(),
        ]),
        (Some(v), None) => a.extend([
            "-filter_complex".into(), v,
            "-map".into(), "[v]".into(),
        ]),
        (None, Some(af)) => a.extend([
            "-filter_complex".into(), af,
            "-map".into(), "0:v".into(),
            "-map".into(), "[aout]".into(),
        ]),
        (None, None) => {
            // gdigrab, no audio: single video stream auto-maps; no filter, no map.
        }
    }
    if has_audio {
        a.extend(["-c:a".into(), "aac".into(), "-b:a".into(), "192k".into()]);
    }

    a.extend(["-movflags".into(), "+faststart".into(), out.into()]);
    a
}

/// Build the mic/system audio filter graph producing `[aout]`, or `None` when there is no
/// audio. Input labels start at `base` (1 for gdigrab, 0 for ddagrab). Every output is
/// normalized to stereo/48 kHz (`AFMT`) so the aac params are byte-identical across
/// segments regardless of which/how many sources connected — the concat `-c copy` invariant.
fn audio_graph(audio: &[AudioInput], silent_pad: bool, base: usize) -> Option<String> {
    const AFMT: &str = "aformat=sample_rates=48000:channel_layouts=stereo";
    // Voice cleanup applied to the MIC only (system audio passes through clean):
    //  • pan=stereo|c0=c0|c1=c0 — mono-safe dual-mono from c0 (works for mono OR
    //    stereo-presented mics; referencing c1 would error on a truly-mono input,
    //    and keeping both channels would one-side a mono-on-left mic).
    //  • highpass 80 Hz — de-rumble.
    //  • +1.5 dB shelf ~200 Hz — restore body/warmth ("fuller").
    //  • +3 dB high shelf @ 7.5 kHz — air/clarity (fixes "muffled") without a fixed
    //    presence bell that sounded processed.
    const MIC_FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=200:width_type=o:width=1.2:g=1.5,treble=g=3:f=7500:width_type=q:width=0.7";

    if silent_pad {
        return Some(format!("[{base}:a]{AFMT}[aout]"));
    }
    match audio.len() {
        0 => None,
        1 => {
            let fx = if audio[0].is_mic { format!(",{MIC_FX}") } else { String::new() };
            Some(format!("[{base}:a]aresample=async=1{fx},{AFMT}[aout]"))
        }
        n => {
            // Pre-filter mic inputs (voice EQ); system inputs pass straight in.
            // normalize=0: don't scale each input by 1/N (the default), which halves a
            // source's volume. Since the unselected source is muted (silence), summing
            // at full level keeps the active source(s) at their true loudness.
            let mut chains = String::new();
            let mut labels = String::new();
            for (idx, ai) in audio.iter().enumerate() {
                let i = idx + base;
                if ai.is_mic {
                    chains.push_str(&format!("[{i}:a]{MIC_FX}[m{i}];"));
                    labels.push_str(&format!("[m{i}]"));
                } else {
                    labels.push_str(&format!("[{i}:a]"));
                }
            }
            Some(format!("{chains}{labels}amix=inputs={n}:duration=longest:normalize=0,aresample=async=1,{AFMT}[aout]"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::RecordTarget;

    #[test]
    fn args_silence_stderr_to_avoid_pipe_backpressure() {
        // The undrained capacity-1 sidecar channel stalls ffmpeg if stderr is chatty;
        // these flags keep it quiet after startup. Guard against a regression.
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
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
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, true);
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
        let a30 = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "out.mp4", &[], false, true);
        let a60 = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 60, "out.mp4", &[], false, true);
        let fr = |a: &[String]| a.windows(2).find(|w| w[0] == "-framerate").map(|w| w[1].clone());
        assert_eq!(fr(&a30).as_deref(), Some("30"));
        assert_eq!(fr(&a60).as_deref(), Some("60"));
    }

    #[test]
    fn ddagrab_fullscreen_uses_filter_source_no_gdigrab() {
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 60, "C:/o.mp4", &[], false, true);
        // No gdigrab, no "-i desktop"; a d3d11 device is initialized.
        assert!(!a.iter().any(|s| s == "gdigrab"));
        assert!(!a.iter().any(|s| s == "desktop"));
        assert!(a.windows(2).any(|w| w[0] == "-init_hw_device" && w[1] == "d3d11va"));
        // The filter_complex carries a ddagrab source at 60 fps + hwdownload to bgra, labelled [v].
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("ddagrab=output_idx=0"));
        assert!(fc.contains("framerate=60"));
        assert!(fc.contains("hwdownload,format=bgra[v]"));
        // Video is mapped from the filter output.
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        // Same encode tail as gdigrab (concat-copy homogeneity).
        assert!(a.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(a.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
        assert_eq!(a.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn ddagrab_region_puts_crop_in_the_source() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &t, 30, "C:/r.mp4", &[], false, true);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("video_size=640x480"));
        assert!(fc.contains("offset_x=100"));
        assert!(fc.contains("offset_y=50"));
    }

    #[test]
    fn ddagrab_draw_mouse_flag_maps_to_source_option() {
        let on = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, true);
        let off = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "o.mp4", &[], false, false);
        let fc = |a: &[String]| a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc(&on).contains("draw_mouse=1"));
        assert!(fc(&off).contains("draw_mouse=0"));
    }

    #[test]
    fn ddagrab_with_audio_combines_v_and_aout_and_shifts_index() {
        // ddagrab has no video input, so the single audio pipe is input 0 → [0:a].
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 60, "C:/o.mp4", &[ai(48000)], true, true);
        let fc = a.iter().position(|s| s == "-filter_complex").map(|i| a[i + 1].clone()).unwrap();
        assert!(fc.contains("hwdownload,format=bgra[v]"));
        assert!(fc.contains("[0:a]aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[aout]"));
        assert!(a.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
    }

    #[test]
    fn ddagrab_no_audio_still_maps_video() {
        let a = build_ffmpeg_args(CaptureEngine::Ddagrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
        assert!(a.windows(2).any(|w| w[0] == "-map" && w[1] == "[v]"));
        assert!(!a.iter().any(|s| s == "-c:a"));
    }

    #[test]
    fn region_args_carry_offset_and_size() {
        let t = RecordTarget::Region { x: 100, y: 50, w: 640, h: 480 };
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &t, 30, "C:/r.mp4", &[], false, true);
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
    }

    #[test]
    fn draw_mouse_off_inserts_flag() {
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, false);
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
        let a = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/out.mp4", &[], false, true);
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
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
        assert!(!v.iter().any(|s| s == "-c:a"));
        assert!(!v.iter().any(|s| s == "-filter_complex"));
        assert!(!v.iter().any(|s| s.contains("anullsrc")));
        assert_eq!(v.last().unwrap(), "C:/o.mp4");
    }

    #[test]
    fn one_source_maps_directly_no_amix() {
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true, true);
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
        const FX: &str = "pan=stereo|c0=c0|c1=c0,highpass=f=80,equalizer=f=200:width_type=o:width=1.2:g=1.5,treble=g=3:f=7500:width_type=q:width=0.7";
        // Single mic source: cleanup inline before the format normalize.
        let m = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai_mic(48000)], true, true);
        assert!(m.iter().any(|s| *s == format!("[1:a]aresample=async=1,{FX},aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
        // System (input 1) passes through; mic (input 2) is pre-filtered then mixed.
        let both = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai_mic(48000)], true, true);
        assert!(both.iter().any(|s| *s == format!("[2:a]{FX}[m2];[1:a][m2]amix=inputs=2:duration=longest:normalize=0,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]")));
    }

    #[test]
    fn mic_fx_has_no_body_cut() {
        // Regression guard: the -2 dB @ 400 Hz cut (which thinned the voice) is gone,
        // and the air shelf (which fixes "muffled") is present.
        let m = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai_mic(48000)], true, true);
        assert!(!m.iter().any(|s| s.contains("f=400") && s.contains("g=-2")));
        assert!(m.iter().any(|s| s.contains("treble=g=3:f=7500")));
    }

    #[test]
    fn two_sources_use_amix() {
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000), ai(44100)], true, true);
        assert!(v.iter().any(|s| s == "[1:a][2:a]amix=inputs=2:duration=longest:normalize=0,aresample=async=1,aformat=sample_rates=48000:channel_layouts=stereo[aout]"));
        assert!(v.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        // both rates present as input options
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "48000"));
        assert!(v.windows(2).any(|w| w[0] == "-ar" && w[1] == "44100"));
    }

    #[test]
    fn audio_inputs_carry_thread_queue_size() {
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[ai(48000)], true, true);
        assert!(v.windows(2).any(|w| w[0] == "-thread_queue_size" && w[1] == "1024"));
    }

    #[test]
    fn want_audio_with_no_sources_injects_silent_aac() {
        // Audio wanted but no source connected this segment → a silent anullsrc track
        // keeps the segment's stream layout (video + 1 aac) homogeneous for concat-copy.
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], true, true);
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
        let v = build_ffmpeg_args(CaptureEngine::Gdigrab, &RecordTarget::Fullscreen, 30, "C:/o.mp4", &[], false, true);
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
