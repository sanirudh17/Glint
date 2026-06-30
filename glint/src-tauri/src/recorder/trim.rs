//! Recording trim / quick-edit. ISOLATED (recorder-owned): uses recorder `ffmpeg`/
//! `thumb` + `crate::db` only — nothing from capture/editor/overlay. A SEPARATE
//! ffmpeg pass from recording; the gdigrab capture path is untouched.

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
}
