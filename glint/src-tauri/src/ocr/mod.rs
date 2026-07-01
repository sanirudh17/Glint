//! OCR / Capture Text. Turns pixels into text via the Windows.Media.Ocr engine
//! (fully local, no cloud). ISOLATED from `recorder/` (imports nothing from it, and
//! it imports nothing from here).

pub mod commands;
pub mod window;

#[derive(Clone, serde::Serialize)]
pub struct OcrOutput {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

/// The last OCR result, stashed for the `#/ocr` panel to read back (mirrors the trim
/// window's `TrimTarget` pattern).
#[derive(Default)]
pub struct OcrState(pub std::sync::Mutex<Option<OcrOutput>>);

/// Join OCR lines into a single block of text: trim trailing whitespace per line,
/// join with `\n`, drop a trailing blank tail. Empty / whitespace-only → None.
pub fn assemble_text(lines: &[String]) -> Option<String> {
    let joined = lines
        .iter()
        .map(|l| l.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = joined.trim_matches('\n');
    if trimmed.trim().is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// How much to enlarge captured pixels before OCR. Windows.Media.Ocr recognizes
/// small screenshot text far more accurately when glyphs are larger — native-res
/// UI/terminal text (~10px tall) triggers l/1/I and m/rn confusions and dropped
/// characters; enlarging to ~30px resolves most of them.
const OCR_UPSCALE: f32 = 3.0;

/// Target dimensions to feed the OCR engine: enlarge by `OCR_UPSCALE` for accuracy,
/// but never exceed `max_dim` on the longest side. If the source ALREADY exceeds
/// `max_dim` the factor drops below 1 and we downscale to fit (oversized bitmaps are
/// rejected/truncated by the engine). Zero-area or zero `max_dim` → unchanged.
pub fn ocr_target_dims(w: u32, h: u32, max_dim: u32) -> (u32, u32) {
    if w == 0 || h == 0 || max_dim == 0 {
        return (w, h);
    }
    let longest = w.max(h) as f32;
    let factor = OCR_UPSCALE.min(max_dim as f32 / longest);
    let tw = ((w as f32) * factor).round().max(1.0) as u32;
    let th = ((h as f32) * factor).round().max(1.0) as u32;
    (tw, th)
}

/// Is this a mostly-DARK-background region (light text on dark — a terminal or
/// dark-mode UI)? Windows OCR is tuned for dark-on-light, so we invert these first.
/// `gray` is one luma byte per pixel.
fn is_dark_background(gray: &[u8]) -> bool {
    if gray.is_empty() {
        return false;
    }
    let sum: u64 = gray.iter().map(|&v| v as u64).sum();
    (sum / gray.len() as u64) < 128
}

/// Build an auto-contrast lookup table stretching the 2nd–98th luma percentiles to
/// the full 0–255 range, sharpening text/background separation. Returns `None` when
/// the region has too little contrast to stretch safely (near-uniform regions —
/// stretching would just amplify noise). `gray` is one luma byte per pixel.
fn contrast_lut(gray: &[u8]) -> Option<[u8; 256]> {
    if gray.is_empty() {
        return None;
    }
    let mut hist = [0u32; 256];
    for &v in gray {
        hist[v as usize] += 1;
    }
    let total = gray.len() as f32;
    let lo_count = (total * 0.02) as u32;
    let hi_count = (total * 0.98) as u32;
    let (mut lo, mut hi, mut lo_set, mut cum) = (0u8, 255u8, false, 0u32);
    for (v, &count) in hist.iter().enumerate() {
        cum += count;
        if !lo_set && cum >= lo_count {
            lo = v as u8;
            lo_set = true;
        }
        if cum >= hi_count {
            hi = v as u8;
            break;
        }
    }
    if (hi as i32) - (lo as i32) < 16 {
        return None; // too flat to stretch
    }
    let span = (hi - lo) as f32;
    let mut lut = [0u8; 256];
    for (i, out) in lut.iter_mut().enumerate() {
        let v = ((i as f32 - lo as f32) / span * 255.0).round().clamp(0.0, 255.0);
        *out = v as u8;
    }
    Some(lut)
}

/// Run Windows.Media.Ocr on RGBA pixels. Fully local. Returns assembled text, or a
/// user-facing error: no OCR language installed or bad input. "No text found" is NOT
/// an error — it yields an empty result so callers can show an empty state.
///
/// The crop is PREPROCESSED before recognition, since native-res screen text is a
/// hard case for Windows OCR: grayscale → invert dark backgrounds to dark-on-light
/// (terminals / dark-mode UIs read poorly otherwise) → auto-contrast stretch →
/// upscale (CatmullRom, ~[`OCR_UPSCALE`]×, capped to the engine's `MaxImageDimension`).
/// The result is fed as a BGRA8 `SoftwareBitmap`. The async recognition blocks —
/// callers MUST run this off the main thread.
pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String> {
    use image::{imageops::FilterType, ImageBuffer, Rgba};
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows_future::AsyncOperationCompletedHandler;

    const NO_LANG: &str =
        "OCR isn't available — install a language pack in Windows Settings → Time & Language.";

    let need = w as usize * h as usize * 4;
    if w == 0 || h == 0 || rgba.len() < need {
        return Err("Couldn't read text".into());
    }

    // Grayscale (Windows OCR grayscales internally anyway; doing it here lets us
    // normalize polarity + contrast, which it does NOT do).
    let rgba_img: ImageBuffer<Rgba<u8>, &[u8]> =
        ImageBuffer::from_raw(w, h, &rgba[..need]).ok_or("Couldn't read text")?;
    let mut gray = image::imageops::grayscale(&rgba_img); // GrayImage, original res

    // Invert light-on-dark → dark-on-light (the engine's strong suit).
    if is_dark_background(&gray) {
        for v in gray.iter_mut() {
            *v = 255 - *v;
        }
    }
    // Stretch contrast so text/background separate crisply (skipped for flat regions).
    if let Some(lut) = contrast_lut(&gray) {
        for v in gray.iter_mut() {
            *v = lut[*v as usize];
        }
    }

    // Enlarge for accuracy, bounded by what the engine accepts. A smooth (low-ringing)
    // filter keeps text edges clean; ringing would create new glyph confusions.
    let max_dim = OcrEngine::MaxImageDimension().unwrap_or(10_000);
    let (rw, rh) = ocr_target_dims(w, h, max_dim);
    let gray = if (rw, rh) == (w, h) {
        gray
    } else {
        image::imageops::resize(&gray, rw, rh, FilterType::CatmullRom)
    };

    // Expand grayscale to the BGRA8 buffer Windows OCR wants (v, v, v, 255).
    let mut bgra = vec![0u8; (rw as usize) * (rh as usize) * 4];
    for (dst, &v) in bgra.chunks_exact_mut(4).zip(gray.as_raw().iter()) {
        dst[0] = v;
        dst[1] = v;
        dst[2] = v;
        dst[3] = 255;
    }

    // Wrap the bytes in an IBuffer and build a SoftwareBitmap.
    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&bgra).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        rw as i32,
        rh as i32,
    )
    .map_err(|e| e.to_string())?;

    // Engine from the user's installed languages; err => no OCR language pack.
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| NO_LANG.to_string())?;

    // windows-rs 0.62 dropped the blocking `.get()` on IAsyncOperation and keeps
    // the `Async::join` helper private. Wait synchronously via a completion
    // handler + channel, then pull the results.
    let op = engine.RecognizeAsync(&bitmap).map_err(|e| e.to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    op.SetCompleted(&AsyncOperationCompletedHandler::new(move |_op, _status| {
        let _ = tx.send(());
        Ok(())
    }))
    .map_err(|e| e.to_string())?;
    let _ = rx.recv();
    let result = op.GetResults().map_err(|e| e.to_string())?;

    let lines_view = result.Lines().map_err(|e| e.to_string())?;
    let mut lines: Vec<String> = Vec::new();
    for line in lines_view {
        if let Ok(t) = line.Text() {
            lines.push(t.to_string());
        }
    }

    // The engine ran but found nothing → an EMPTY result, not an error: callers
    // publish it so the panel shows its empty state. `Err` is reserved for real
    // failures (bad input / no engine, handled above), which surface as a toast.
    let text = assemble_text(&lines).unwrap_or_default();
    let line_count = text.lines().count();
    let word_count = text.split_whitespace().count();
    Ok(OcrOutput { text, line_count, word_count })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_lines_with_newlines() {
        let lines = vec!["hello".to_string(), "world".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "hello\nworld");
    }

    #[test]
    fn trims_trailing_whitespace_per_line() {
        let lines = vec!["a   ".to_string(), "b\t".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "a\nb");
    }

    #[test]
    fn empty_slice_is_none() {
        let lines: Vec<String> = vec![];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn all_whitespace_is_none() {
        let lines = vec!["   ".to_string(), "".to_string()];
        assert!(assemble_text(&lines).is_none());
    }

    #[test]
    fn single_line_no_newline() {
        let lines = vec!["solo".to_string()];
        assert_eq!(assemble_text(&lines).unwrap(), "solo");
    }

    #[test]
    fn upscales_small_regions_by_the_factor() {
        // 3x, comfortably under the cap.
        assert_eq!(ocr_target_dims(800, 600, 10_000), (2400, 1800));
    }

    #[test]
    fn caps_the_longest_side_at_max_dim() {
        // 6000 * 3 = 18000 > 10000 → factor 10000/6000 ≈ 1.667.
        assert_eq!(ocr_target_dims(6000, 400, 10_000), (10_000, 667));
    }

    #[test]
    fn downscales_sources_already_over_max_dim() {
        // 12000 already exceeds 10000 → factor 0.833, downscale to fit.
        assert_eq!(ocr_target_dims(12_000, 400, 10_000), (10_000, 333));
    }

    #[test]
    fn leaves_degenerate_inputs_unchanged() {
        assert_eq!(ocr_target_dims(0, 0, 10_000), (0, 0));
        assert_eq!(ocr_target_dims(100, 100, 0), (100, 100));
    }

    #[test]
    fn detects_dark_vs_light_backgrounds() {
        assert!(is_dark_background(&[0, 0, 0, 20])); // mostly dark → invert
        assert!(!is_dark_background(&[255, 255, 255, 200])); // mostly light → keep
        assert!(!is_dark_background(&[])); // nothing → don't invert
    }

    #[test]
    fn contrast_lut_stretches_a_bimodal_region() {
        // 50 dark + 50 light pixels → stretch the ends to 0 and 255.
        let mut px = vec![30u8; 50];
        px.extend(std::iter::repeat(210u8).take(50));
        let lut = contrast_lut(&px).expect("bimodal region should stretch");
        assert_eq!(lut[30], 0);
        assert_eq!(lut[210], 255);
        assert!(lut[120] > 100 && lut[120] < 160); // midtone lands mid-range
    }

    #[test]
    fn contrast_lut_skips_flat_regions() {
        assert!(contrast_lut(&[100u8; 64]).is_none()); // uniform → no stretch
        assert!(contrast_lut(&[]).is_none());
    }
}
