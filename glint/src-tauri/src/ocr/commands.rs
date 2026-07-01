//! Tauri command surface for OCR. Thin — delegates to `ocr::recognize` + reused
//! helpers. Flow commands (capture-region / extract) are added in later tasks.
use tauri::Manager;

use super::OcrState;

#[derive(serde::Serialize)]
pub struct OcrResultDto {
    pub text: String,
    pub line_count: usize,
    pub word_count: usize,
}

/// The `#/ocr` panel reads back the last OCR result.
#[tauri::command]
pub fn ocr_result(app: tauri::AppHandle) -> Option<OcrResultDto> {
    app.state::<OcrState>()
        .0
        .lock()
        .unwrap()
        .as_ref()
        .map(|o| OcrResultDto {
            text: o.text.clone(),
            line_count: o.line_count,
            word_count: o.word_count,
        })
}

/// Re-copy text from the panel (after an edit or partial selection).
#[tauri::command]
pub fn ocr_copy(text: String) -> Result<(), String> {
    crate::clipboard::copy_text(&text)
}

/// Stash the OCR output for the panel and open (or focus) it. Shared by every OCR
/// flow. Deliberately does NOT copy to the clipboard — the user copies explicitly
/// (all text or a selection) from the panel, so we never clutter their clipboard
/// with text they didn't ask for. Runs off the main thread (callers are async/spawned).
pub fn publish_and_open(app: &tauri::AppHandle, out: super::OcrOutput) {
    *app.state::<OcrState>().0.lock().unwrap() = Some(out);
    let _ = super::window::build_ocr_window(app);
}

/// Start a Capture Text session (freeze + overlay). On region commit, `capture_commit`
/// routes to OCR. Async: it freezes the screen + shows the overlay off the main thread.
#[tauri::command(async)]
pub async fn ocr_capture_region(app: tauri::AppHandle) -> Result<(), String> {
    crate::capture::begin_ocr_capture(&app);
    Ok(())
}

/// OCR the most recent capture straight from its in-memory RGBA (what the HUD acts
/// on) — no Library id needed, mirroring `hud_copy`. Async: it builds the panel.
#[tauri::command(async)]
pub async fn ocr_extract_last(app: tauri::AppHandle) -> Result<(), String> {
    let (rgba, w, h) = {
        let state = app.state::<crate::capture::LastCaptureState>();
        let guard = state.0.lock().unwrap();
        let last = guard.as_ref().ok_or("No capture to read")?;
        (last.rgba.clone(), last.width, last.height)
    };
    // Real failures (bad input / no engine) return Err for the frontend caller to
    // surface — no separate backend toast (that would double-message). "No text"
    // is not an error: recognize returns an empty result and the panel opens empty.
    let out = super::recognize(&rgba, w, h)?;
    publish_and_open(&app, out);
    Ok(())
}

/// OCR an existing Library capture (image) by id: decode its PNG, recognize, copy,
/// and open the panel. Async because it builds the panel window.
#[tauri::command(async)]
pub async fn ocr_extract_capture(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    let path = {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        crate::db::capture_path(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("Couldn't open that capture")?
    };
    let bytes = std::fs::read(&path).map_err(|_| "Couldn't open that capture".to_string())?;
    let img = image::load_from_memory(&bytes)
        .map_err(|_| "Couldn't open that capture".to_string())?
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    // See ocr_extract_last: Err surfaces via the caller; empty text opens the panel.
    let out = super::recognize(&img.into_raw(), w, h)?;
    publish_and_open(&app, out);
    Ok(())
}
