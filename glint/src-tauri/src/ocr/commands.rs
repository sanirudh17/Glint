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

/// Copy the text, stash the output for the panel, and open (or focus) the panel.
/// Shared by every OCR flow. Runs off the main thread (callers are async/spawned).
pub fn publish_and_open(app: &tauri::AppHandle, out: super::OcrOutput) {
    let _ = crate::clipboard::copy_text(&out.text);
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
    match super::recognize(&img.into_raw(), w, h) {
        Ok(out) => {
            publish_and_open(&app, out);
            Ok(())
        }
        Err(e) => {
            let _ = tauri::Emitter::emit(&app, "glint-toast", &e);
            Err(e)
        }
    }
}
