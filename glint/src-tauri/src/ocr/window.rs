//! Off-thread builder for the OCR review panel — a small NORMAL decorated window
//! (label `ocr`), unlike the transparent capture overlays. Built from async/spawned
//! contexts only (window-build rule). Single instance.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OCR_LABEL: &str = "ocr";

/// Build (or focus, if already open) the OCR review panel.
pub fn build_ocr_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(OCR_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
        let _ = win.set_always_on_top(false);
        let _ = app.emit_to(OCR_LABEL, "ocr-reload", ());
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, OCR_LABEL, WebviewUrl::App("index.html#/ocr".into()))
        .title("Glint — Captured Text")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .inner_size(460.0, 240.0)
        .min_inner_size(360.0, 180.0)
        .center()
        .visible(true)
        .build()?;
    let _ = win.set_always_on_top(true);
    let _ = win.set_focus();
    let _ = win.set_always_on_top(false);
    Ok(())
}
