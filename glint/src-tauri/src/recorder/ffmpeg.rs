use crate::recorder::RecordTarget;

/// Round down to the nearest even number (yuv420p needs even width/height).
pub fn even(n: u32) -> u32 {
    n - (n % 2)
}

/// Build the ffmpeg arg list: capture the screen via gdigrab and encode H.264 MP4.
/// `-preset ultrafast` keeps encoding real-time at 30 fps; `+faststart` + a clean
/// `q`-driven stop yield a seekable, playable file.
pub fn build_ffmpeg_args(target: &RecordTarget, fps: u32, out: &str) -> Vec<String> {
    let mut a: Vec<String> = vec!["-y".into(), "-f".into(), "gdigrab".into(),
        "-framerate".into(), fps.to_string()];
    if let RecordTarget::Region { x, y, w, h } = target {
        a.extend([
            "-offset_x".into(), x.to_string(),
            "-offset_y".into(), y.to_string(),
            "-video_size".into(), format!("{w}x{h}"),
        ]);
    }
    a.extend([
        "-i".into(), "desktop".into(),
        "-c:v".into(), "libx264".into(),
        "-preset".into(), "ultrafast".into(),
        "-pix_fmt".into(), "yuv420p".into(),
        "-movflags".into(), "+faststart".into(),
        out.into(),
    ]);
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recorder::RecordTarget;

    #[test]
    fn even_rounds_down() {
        assert_eq!(even(1920), 1920);
        assert_eq!(even(1921), 1920);
        assert_eq!(even(1), 0);
    }

    #[test]
    fn fullscreen_args_have_no_offset() {
        let a = build_ffmpeg_args(&RecordTarget::Fullscreen, 30, "C:/out.mp4");
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
        let a = build_ffmpeg_args(&t, 30, "C:/r.mp4");
        assert!(a.windows(2).any(|w| w[0] == "-offset_x" && w[1] == "100"));
        assert!(a.windows(2).any(|w| w[0] == "-offset_y" && w[1] == "50"));
        assert!(a.windows(2).any(|w| w[0] == "-video_size" && w[1] == "640x480"));
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
