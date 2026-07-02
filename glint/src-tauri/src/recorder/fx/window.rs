//! The rec-fx overlay: a transparent, click-through, always-on-top, focus-less
//! window covering the recording area. NOT excluded from capture — gdigrab records
//! whatever its canvas draws (the webcam-bubble trick). Built off the main thread.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::recorder::RecordTarget;

pub const FX_LABEL: &str = "rec-fx";

pub fn build_fx_overlay(app: &AppHandle, target: RecordTarget) -> tauri::Result<()> {
    if app.get_webview_window(FX_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, FX_LABEL, WebviewUrl::App("index.html#/rec-fx".into()))
        .title("Glint FX")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    // Cover the recording area in PHYSICAL px (region coords are physical; fullscreen
    // = whole primary monitor). Mirrors build_cam_bubble's target math.
    if let Some(m) = win.primary_monitor()? {
        let (x, y, w, h) = match target {
            RecordTarget::Region { x, y, w, h } => (x, y, w as i32, h as i32),
            RecordTarget::Fullscreen => {
                let pos = m.position();
                let size = m.size();
                (pos.x, pos.y, size.width as i32, size.height as i32)
            }
        };
        win.set_position(tauri::PhysicalPosition { x, y })?;
        win.set_size(tauri::PhysicalSize { width: w as u32, height: h as u32 })?;
    }

    // Click-through: pointer events pass to the app underneath. Permitted by the
    // `recorder` capability (core:window:allow-set-ignore-cursor-events, rec-*).
    win.set_ignore_cursor_events(true)?;
    win.show()?;
    Ok(())
}

/// Force-tear-down (destroy, not close) so a transparent focus-less window can't
/// linger on screen and keep getting recorded — same rationale as the cam bubble.
pub fn close_fx_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(FX_LABEL) {
        let _ = w.destroy();
    }
}
