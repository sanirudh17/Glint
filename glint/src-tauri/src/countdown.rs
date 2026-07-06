//! Neutral, reusable N-second countdown window. Shared by the recorder (N=3) and
//! delayed capture (N=3/5/10). No coupling to recorder/capture internals — either
//! caller invokes `build`/`close`. The frontend (`Countdown.tsx`, route
//! `#/rec-countdown`) reads `?n=` and self-closes at 0; callers also `close`
//! defensively so the digit never bleeds into the captured frame.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const COUNTDOWN_LABEL: &str = "rec-countdown";

/// Fullscreen, centered, click-through countdown starting at `seconds`. Closes itself
/// at 0 (frontend), but Rust owns the teardown via `close` so a webview that failed to
/// self-close can't be left orphaned. Safe to call when one already exists (no-op).
pub fn build(app: &AppHandle, seconds: u32) -> tauri::Result<()> {
    if app.get_webview_window(COUNTDOWN_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(
        app,
        COUNTDOWN_LABEL,
        WebviewUrl::App(format!("index.html#/rec-countdown?n={seconds}").into()),
    )
    .title("Glint")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()?;

    if let Some(m) = win.primary_monitor()? {
        let pos = m.position();
        let size = m.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize {
            width: size.width,
            height: size.height,
        })?;
    } else {
        log::warn!("rec-countdown: no primary monitor; using default window position");
    }

    win.set_ignore_cursor_events(true)?; // click-through
    // Hidden from screen capture — the digit must never appear in a recording that
    // is being warmed up while the countdown is still on screen.
    crate::window::exclude_from_capture(&win);
    win.show()?;
    Ok(())
}

/// Close the countdown overlay if it is open. Safe to call when none exists.
pub fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = w.close();
    }
}
