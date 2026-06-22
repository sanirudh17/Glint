//! Thumbnail generation for Library cards. Pure resize math + an `image`-backed
//! encoder. No recorder dependency.

use image::{ImageBuffer, Rgba};

/// Aspect-preserving target size so the long edge is at most `max`. Never upscales
/// (a smaller image is returned unchanged). Clamps to a 1px floor.
pub fn thumb_dimensions(w: u32, h: u32, max: u32) -> (u32, u32) {
    let long = w.max(h);
    if long <= max || long == 0 {
        return (w.max(1), h.max(1));
    }
    let scale = max as f64 / long as f64;
    let nw = (w as f64 * scale).round() as u32;
    let nh = (h as f64 * scale).round() as u32;
    (nw.max(1), nh.max(1))
}

/// Downscale RGBA pixels to a thumbnail and encode as PNG bytes.
pub fn make_thumb(rgba: &[u8], w: u32, h: u32, max: u32) -> Result<Vec<u8>, String> {
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(w, h, rgba.to_vec()).ok_or("thumb: bad rgba buffer")?;
    let (tw, th) = thumb_dimensions(w, h, max);
    let resized = image::imageops::resize(&img, tw, th, image::imageops::FilterType::Triangle);
    let mut out = std::io::Cursor::new(Vec::new());
    resized
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wide_image_scales_long_edge_to_max() {
        assert_eq!(thumb_dimensions(1000, 500, 480), (480, 240));
    }

    #[test]
    fn tall_image_scales_long_edge_to_max() {
        assert_eq!(thumb_dimensions(500, 1000, 480), (240, 480));
    }

    #[test]
    fn small_image_is_unchanged() {
        assert_eq!(thumb_dimensions(120, 80, 480), (120, 80));
    }

    #[test]
    fn never_returns_zero() {
        assert_eq!(thumb_dimensions(10000, 1, 480), (480, 1));
    }

    #[test]
    fn make_thumb_encodes_a_png_at_scaled_size() {
        // 4x2 opaque-red image → downscale to max 2 → 2x1.
        let rgba: Vec<u8> = std::iter::repeat([255u8, 0, 0, 255]).take(4 * 2).flatten().collect();
        let png = make_thumb(&rgba, 4, 2, 2).unwrap();
        let decoded = image::load_from_memory(&png).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (2, 1));
    }
}
