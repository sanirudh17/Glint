//! OCR / Capture Text. Turns pixels into text via the Windows.Media.Ocr engine
//! (fully local, no cloud). ISOLATED from `recorder/` (imports nothing from it, and
//! it imports nothing from here).

#[derive(Clone, serde::Serialize)]
pub struct OcrOutput {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

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

/// Run Windows.Media.Ocr on RGBA pixels. Fully local. Returns assembled text, or a
/// user-facing error: no OCR language installed, empty input, or no text found.
///
/// Windows OCR wants a BGRA8 `SoftwareBitmap`; we swap R/B from our RGBA buffer. The
/// async recognition is `.get()`-blocked — callers MUST run this off the main thread.
pub fn recognize(rgba: &[u8], w: u32, h: u32) -> Result<OcrOutput, String> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows_future::AsyncOperationCompletedHandler;

    const NO_LANG: &str =
        "OCR isn't available — install a language pack in Windows Settings → Time & Language.";

    if w == 0 || h == 0 || rgba.len() < (w as usize * h as usize * 4) {
        return Err("Couldn't read text".into());
    }

    // RGBA -> BGRA (Windows imaging expects BGRA8 for OCR).
    let mut bgra = vec![0u8; rgba.len()];
    for (dst, src) in bgra.chunks_exact_mut(4).zip(rgba.chunks_exact(4)) {
        dst[0] = src[2]; // B
        dst[1] = src[1]; // G
        dst[2] = src[0]; // R
        dst[3] = src[3]; // A
    }

    // Wrap the bytes in an IBuffer and build a SoftwareBitmap.
    let writer = DataWriter::new().map_err(|e| e.to_string())?;
    writer.WriteBytes(&bgra).map_err(|e| e.to_string())?;
    let buffer = writer.DetachBuffer().map_err(|e| e.to_string())?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        w as i32,
        h as i32,
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

    let text = assemble_text(&lines).ok_or("No text found")?;
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
}
