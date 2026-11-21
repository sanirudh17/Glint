//! Image operations exposed to agents: inspect, and trim to the real content.
//! Pure functions over files — no window, no app state — so they are unit-tested
//! directly and can never touch the running app.
use image::{Rgba, RgbaImage};
use rmcp::schemars;
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum TrimMode {
    /// Transparent margins if the border has any, otherwise a uniform border colour.
    Auto,
    /// Remove fully (or nearly) transparent margins.
    Transparent,
    /// Remove a uniform background colour sampled from the corners.
    Background,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Bounds {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
pub struct ImageInfo {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub bytes: u64,
    pub has_transparency: bool,
    /// What `image_trim` in auto mode would keep, and how it decided.
    pub content_bounds: Option<Bounds>,
    pub trim_mode: Option<TrimMode>,
}

#[derive(Debug, Serialize)]
pub struct TrimResult {
    pub output: String,
    pub mode: TrimMode,
    pub original: Bounds,
    pub kept: Bounds,
    pub width: u32,
    pub height: u32,
}

pub fn load(path: &Path) -> Result<RgbaImage, String> {
    if !path.is_file() {
        return Err(format!("No image file at {}", path.display()));
    }
    image::open(path)
        .map(|image| image.to_rgba8())
        .map_err(|e| format!("Couldn't read {} as an image: {e}", path.display()))
}

fn differs(a: &Rgba<u8>, b: &Rgba<u8>, tolerance: u8) -> bool {
    (0..4).any(|c| a[c].abs_diff(b[c]) > tolerance)
}

/// The corner colour, if all four corners agree within `tolerance`.
fn uniform_corners(image: &RgbaImage, tolerance: u8) -> Option<Rgba<u8>> {
    let (w, h) = image.dimensions();
    let corners = [image.get_pixel(0, 0), image.get_pixel(w - 1, 0), image.get_pixel(0, h - 1), image.get_pixel(w - 1, h - 1)];
    corners.iter().all(|c| !differs(c, corners[0], tolerance)).then_some(*corners[0])
}

fn border_has_transparency(image: &RgbaImage) -> bool {
    let (w, h) = image.dimensions();
    (0..w).any(|x| image.get_pixel(x, 0)[3] < 255 || image.get_pixel(x, h - 1)[3] < 255)
        || (0..h).any(|y| image.get_pixel(0, y)[3] < 255 || image.get_pixel(w - 1, y)[3] < 255)
}

/// Bounding box of pixels that count as content under `mode`. `None` means the
/// image is entirely margin (nothing to keep).
pub fn content_bounds(image: &RgbaImage, mode: TrimMode, tolerance: u8) -> Result<(TrimMode, Option<Bounds>), String> {
    let mode = match mode {
        TrimMode::Auto if border_has_transparency(image) => TrimMode::Transparent,
        TrimMode::Auto if uniform_corners(image, tolerance).is_some() => TrimMode::Background,
        TrimMode::Auto => {
            let (width, height) = image.dimensions();
            return Ok((TrimMode::Auto, Some(Bounds { x: 0, y: 0, width, height })));
        }
        other => other,
    };
    let background = match mode {
        TrimMode::Background => Some(uniform_corners(image, tolerance).ok_or(
            "The corners aren't one uniform colour, so there's no background to trim. Try mode \"transparent\" or a higher tolerance.",
        )?),
        _ => None,
    };
    let is_content = |p: &Rgba<u8>| match background {
        Some(bg) => differs(p, &bg, tolerance),
        None => p[3] > tolerance,
    };
    let (mut left, mut top, mut right, mut bottom) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, p) in image.enumerate_pixels() {
        if is_content(p) {
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
    }
    Ok((mode, (left != u32::MAX).then(|| Bounds { x: left, y: top, width: right - left + 1, height: bottom - top + 1 })))
}

pub fn info(path: &Path) -> Result<ImageInfo, String> {
    let image = load(path)?;
    let (mode, bounds) = content_bounds(&image, TrimMode::Auto, 8)?;
    Ok(ImageInfo {
        path: path.display().to_string(),
        width: image.width(),
        height: image.height(),
        bytes: std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        has_transparency: image.pixels().any(|p| p[3] < 255),
        content_bounds: bounds,
        trim_mode: Some(mode),
    })
}

/// `<stem> (suffix).png` beside the input, numbered so nothing is overwritten.
pub fn sibling_output(input: &Path, suffix: &str) -> PathBuf {
    let dir = input.parent().unwrap_or(Path::new("."));
    let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let mut candidate = dir.join(format!("{stem} ({suffix}).png"));
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({suffix} {n}).png"));
        n += 1;
    }
    candidate
}

/// Crop to the content bounds (plus `padding`) and write a new PNG. The input is
/// never modified; an explicit `output` must not already exist or be the input.
pub fn trim(input: &Path, output: Option<&Path>, mode: TrimMode, tolerance: u8, padding: u32) -> Result<TrimResult, String> {
    let image = load(input)?;
    let (used, bounds) = content_bounds(&image, mode, tolerance)?;
    let kept = bounds.ok_or("The whole image is margin under this mode and tolerance — nothing would be left.")?;
    let (w, h) = image.dimensions();
    let x = kept.x.saturating_sub(padding);
    let y = kept.y.saturating_sub(padding);
    let kept = Bounds { x, y, width: (kept.x + kept.width + padding).min(w) - x, height: (kept.y + kept.height + padding).min(h) - y };
    let output = match output {
        Some(path) => {
            if path == input || path.exists() {
                return Err(format!("{} already exists; choose a new output path (Glint never overwrites files).", path.display()));
            }
            path.to_path_buf()
        }
        None => sibling_output(input, "trimmed"),
    };
    let cropped = image::imageops::crop_imm(&image, kept.x, kept.y, kept.width, kept.height).to_image();
    cropped.save_with_format(&output, image::ImageFormat::Png).map_err(|e| format!("Couldn't write {}: {e}", output.display()))?;
    Ok(TrimResult {
        output: output.display().to_string(),
        mode: used,
        original: Bounds { x: 0, y: 0, width: w, height: h },
        kept,
        width: kept.width,
        height: kept.height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 40×30 opaque "rounded square" at (25,10) on a 100×60 transparent canvas,
    /// with soft (partly transparent) anti-aliased corners.
    fn rounded_on_transparent() -> RgbaImage {
        let mut img = RgbaImage::from_pixel(100, 60, Rgba([0, 0, 0, 0]));
        for y in 10..40 {
            for x in 25..65 {
                let corner = (x == 25 || x == 64) && (y == 10 || y == 39);
                img.put_pixel(x, y, Rgba([200, 40, 90, if corner { 90 } else { 255 }]));
            }
        }
        img
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("glint-mcp-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn transparent_margins_trim_to_the_exact_shape_including_soft_corners() {
        let (mode, bounds) = content_bounds(&rounded_on_transparent(), TrimMode::Auto, 0).unwrap();
        assert_eq!(mode, TrimMode::Transparent);
        assert_eq!(bounds, Some(Bounds { x: 25, y: 10, width: 40, height: 30 }));
    }

    #[test]
    fn uniform_background_is_trimmed_and_noise_inside_tolerance_is_ignored() {
        let mut img = RgbaImage::from_pixel(80, 50, Rgba([250, 250, 250, 255]));
        img.put_pixel(3, 3, Rgba([246, 252, 249, 255])); // JPEG-ish noise, within tolerance
        for y in 20..30 {
            for x in 30..50 {
                img.put_pixel(x, y, Rgba([20, 20, 20, 255]));
            }
        }
        let (mode, bounds) = content_bounds(&img, TrimMode::Auto, 8).unwrap();
        assert_eq!(mode, TrimMode::Background);
        assert_eq!(bounds, Some(Bounds { x: 30, y: 20, width: 20, height: 10 }));
    }

    #[test]
    fn busy_edges_keep_the_whole_image_in_auto_and_explain_in_background_mode() {
        let img = RgbaImage::from_fn(20, 20, |x, y| Rgba([(x * 12) as u8, (y * 12) as u8, 0, 255]));
        assert_eq!(content_bounds(&img, TrimMode::Auto, 8).unwrap().1, Some(Bounds { x: 0, y: 0, width: 20, height: 20 }));
        assert!(content_bounds(&img, TrimMode::Background, 8).unwrap_err().contains("uniform"));
    }

    #[test]
    fn trim_writes_a_new_file_and_never_overwrites() {
        let dir = temp_dir("trim");
        let input = dir.join("shape.png");
        rounded_on_transparent().save(&input).unwrap();
        let before = std::fs::read(&input).unwrap();

        let first = trim(&input, None, TrimMode::Auto, 0, 0).unwrap();
        assert!(first.output.ends_with("shape (trimmed).png"));
        assert_eq!((first.width, first.height), (40, 30));
        let second = trim(&input, None, TrimMode::Auto, 0, 2).unwrap();
        assert!(second.output.ends_with("shape (trimmed 2).png"));
        assert_eq!((second.width, second.height), (44, 34));
        assert_eq!(std::fs::read(&input).unwrap(), before, "input untouched");

        assert!(trim(&input, Some(&input), TrimMode::Auto, 0, 0).is_err());
        assert!(trim(&input, Some(Path::new(&first.output)), TrimMode::Auto, 0, 0).is_err());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn all_margin_images_are_rejected_not_written_empty() {
        let dir = temp_dir("empty");
        let input = dir.join("blank.png");
        RgbaImage::from_pixel(10, 10, Rgba([0, 0, 0, 0])).save(&input).unwrap();
        assert!(trim(&input, None, TrimMode::Transparent, 0, 0).unwrap_err().contains("nothing would be left"));
        assert!(!dir.join("blank (trimmed).png").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
