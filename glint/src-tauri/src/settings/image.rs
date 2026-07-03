//! Encode saved screenshots in the user's chosen format. PNG/WebP keep RGBA; JPEG is opaque
//! (screenshots have alpha=255, so dropping it is visually lossless). Fully local, no assets.
use image::{codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, codecs::webp::WebPEncoder,
    ExtendedColorType, ImageEncoder};

/// Map the quality bucket to a JPEG quality (1..=100).
pub fn jpeg_q(level: &str) -> u8 {
    match level {
        "medium" => 80,
        "low" => 65,
        _ => 92, // "high" and any unknown
    }
}

/// Encode `rgba` (row-major, 4 bytes/px) as the chosen format. Returns the bytes and the file
/// extension (no dot). Unknown format falls back to PNG.
pub fn encode_save(rgba: &[u8], w: u32, h: u32, fmt: &str, quality: &str)
    -> Result<(Vec<u8>, &'static str), String>
{
    let mut out = Vec::new();
    match fmt {
        "jpeg" => {
            // JPEG has no alpha channel — drop it (screenshots are opaque).
            let mut rgb = Vec::with_capacity((w * h * 3) as usize);
            for px in rgba.chunks_exact(4) {
                rgb.extend_from_slice(&px[0..3]);
            }
            JpegEncoder::new_with_quality(&mut out, jpeg_q(quality))
                .write_image(&rgb, w, h, ExtendedColorType::Rgb8)
                .map_err(|e| e.to_string())?;
            Ok((out, "jpg"))
        }
        "webp" => {
            WebPEncoder::new_lossless(&mut out)
                .write_image(rgba, w, h, ExtendedColorType::Rgba8)
                .map_err(|e| e.to_string())?;
            Ok((out, "webp"))
        }
        _ => {
            PngEncoder::new(&mut out)
                .write_image(rgba, w, h, ExtendedColorType::Rgba8)
                .map_err(|e| e.to_string())?;
            Ok((out, "png"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(w: u32, h: u32) -> Vec<u8> {
        // A simple gradient so JPEG quality actually changes the byte count.
        (0..w * h).flat_map(|i| [(i % 256) as u8, ((i / 2) % 256) as u8, 40, 255]).collect()
    }

    #[test]
    fn png_has_png_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "png", "high").unwrap();
        assert_eq!(&b[0..4], &[0x89, b'P', b'N', b'G']);
        assert_eq!(ext, "png");
    }

    #[test]
    fn jpeg_has_jpeg_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "jpeg", "high").unwrap();
        assert_eq!(&b[0..2], &[0xFF, 0xD8]);
        assert_eq!(ext, "jpg");
    }

    #[test]
    fn webp_has_riff_webp_magic_and_ext() {
        let (b, ext) = encode_save(&rgba(8, 8), 8, 8, "webp", "high").unwrap();
        assert_eq!(&b[0..4], b"RIFF");
        assert_eq!(&b[8..12], b"WEBP");
        assert_eq!(ext, "webp");
    }

    #[test]
    fn lower_jpeg_quality_is_smaller() {
        let hi = encode_save(&rgba(64, 64), 64, 64, "jpeg", "high").unwrap().0;
        let lo = encode_save(&rgba(64, 64), 64, 64, "jpeg", "low").unwrap().0;
        assert!(lo.len() < hi.len(), "low={} should be < high={}", lo.len(), hi.len());
    }

    #[test]
    fn unknown_format_falls_back_to_png() {
        let (b, ext) = encode_save(&rgba(4, 4), 4, 4, "tiff", "high").unwrap();
        assert_eq!(&b[0..4], &[0x89, b'P', b'N', b'G']);
        assert_eq!(ext, "png");
    }
}
