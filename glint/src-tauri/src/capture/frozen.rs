//! Freeze-frame still capture. Windows-facing shell over `xcap`; the only
//! pure/tested piece is PNG encoding. ZERO recorder/ffmpeg dependency.

use crate::capture::geometry::depad;
use std::fmt;

pub struct CapturedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Debug)]
pub enum CaptureError {
    Backend(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CaptureError::Backend(m) => write!(f, "capture backend error: {m}"),
        }
    }
}

impl std::error::Error for CaptureError {}

pub trait ScreenCapturer {
    fn capture_primary(&self) -> Result<CapturedImage, CaptureError>;
}

pub struct XcapCapturer;

impl ScreenCapturer for XcapCapturer {
    fn capture_primary(&self) -> Result<CapturedImage, CaptureError> {
        let monitors =
            xcap::Monitor::all().map_err(|e| CaptureError::Backend(e.to_string()))?;
        let monitor = monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .ok_or_else(|| CaptureError::Backend("no primary monitor".into()))?;
        let rgba_img =
            monitor.capture_image().map_err(|e| CaptureError::Backend(e.to_string()))?;
        let width = rgba_img.width();
        let height = rgba_img.height();
        // xcap returns an RgbaImage already packed; depad is a no-op when stride==width*4,
        // but we route through it to stay robust to padded buffers.
        let raw = rgba_img.into_raw();
        let stride = if height > 0 { raw.len() / height as usize } else { (width as usize) * 4 };
        let packed = depad(&raw, width, height, stride);
        Ok(CapturedImage { width, height, rgba: packed })
    }
}

pub fn encode_png(img: &CapturedImage) -> Result<Vec<u8>, CaptureError> {
    use image::ImageEncoder;
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(
            &img.rgba,
            img.width,
            img.height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    Ok(out)
}

/// Fast PNG encode for latency-sensitive paths (the capture overlay backdrop and
/// the commit's saved file). PNG is lossless, so `CompressionType`/`FilterType`
/// change only the encoded SIZE and the encode TIME — never the decoded pixels.
/// The default encoder's adaptive filter search makes a full-screen encode ~10x
/// slower than it needs to be (measured ~720ms vs ~70ms for 1920x1080); `Fast`
/// zlib + the `Up` filter keeps the bytes modestly larger but the image identical.
pub fn encode_png_fast(img: &CapturedImage) -> Result<Vec<u8>, CaptureError> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use image::ImageEncoder;
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, FilterType::Up)
        .write_image(
            &img.rgba,
            img.width,
            img.height,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_png_roundtrips_dimensions() {
        let img = CapturedImage { width: 2, height: 2, rgba: vec![255u8; 2 * 2 * 4] };
        let png = encode_png(&img).expect("encode");
        // PNG signature
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        let decoded = image::load_from_memory(&png).expect("decode");
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
    }

    #[test]
    fn encode_png_fast_is_lossless_and_valid() {
        // A non-trivial pattern so a filter/compression bug would corrupt pixels.
        let mut rgba = vec![0u8; 8 * 6 * 4];
        for (i, b) in rgba.iter_mut().enumerate() {
            *b = (i % 251) as u8;
        }
        let img = CapturedImage { width: 8, height: 6, rgba: rgba.clone() };
        let png = encode_png_fast(&img).expect("encode");
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10], "PNG signature");
        let decoded = image::load_from_memory(&png).expect("decode").to_rgba8();
        assert_eq!((decoded.width(), decoded.height()), (8, 6));
        // PNG is lossless: decoded pixels must equal the input exactly.
        assert_eq!(decoded.into_raw(), rgba);
    }

    #[test]
    #[ignore = "requires a real display; run manually with --ignored"]
    fn smoke_capture_primary() {
        let img = XcapCapturer.capture_primary().expect("capture");
        assert!(img.width > 0 && img.height > 0);
        assert_eq!(img.rgba.len(), (img.width * img.height * 4) as usize);
    }
}
