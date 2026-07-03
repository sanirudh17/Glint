//! Off-thread builder for the OCR review panel — a small NORMAL decorated window
//! (label `ocr`), unlike the transparent capture overlays. Built from async/spawned
//! contexts only (window-build rule). Single instance.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OCR_LABEL: &str = "ocr";

/// Build (or focus, if already open) the OCR review panel.
pub fn build_ocr_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(OCR_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, OCR_LABEL, WebviewUrl::App("index.html#/ocr".into()))
        .title("Glint — Captured Text")
        .decorations(true)
        .resizable(true)
        .inner_size(680.0, 620.0)
        .min_inner_size(480.0, 400.0)
        .center()
        .visible(true)
        .build()?;
    let _ = win.set_focus();
    Ok(())
}
