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
