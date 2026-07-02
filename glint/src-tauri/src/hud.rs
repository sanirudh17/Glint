//! The post-capture HUD window — a single transient, borderless, transparent,
//! always-on-top bar at the bottom-centre of the capture monitor. Owned by
//! tray-core exactly like the capture overlay: always torn down on the next
//! capture and on dismiss so no orphan window is ever left behind.
//!
//! NOTE: unlike the capture overlay, the HUD is built fresh each capture and
//! CLOSED (not hidden) on teardown. A reuse/pre-warm attempt regressed it: the
//! HUD intentionally never takes focus, and a focus-less transparent WebView2
//! window that is hidden and re-shown repeatedly gets its renderer suspended by
//! Windows' occlusion handling and stops repainting after a few cycles. Building
//! fresh keeps it reliable. (The overlay can be reused because it takes focus.)

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const HUD_LABEL: &str = "hud";

// Logical (CSS px) size of the HUD window. It holds a corner thumbnail card with
// transparent breathing room around it for the seat shadow.
pub const HUD_W: f64 = 244.0;
pub const HUD_H: f64 = 172.0;
// Gap from the monitor's left edge.
pub const MARGIN_X: f64 = 20.0;
// Gap from the monitor's bottom edge — generous so the card clears the Windows
// taskbar (precise work-area insetting is a later polish pass).
pub const MARGIN_Y: f64 = 48.0;

/// Open a fresh HUD window for the current capture result. Tears down any prior
/// HUD first (only one result is ever current). Must run off the main thread —
/// building a webview synchronously on the main thread deadlocks the event loop
/// (see `capture::begin_spawned`). It's called from `finish_commit`, which already
/// runs on a background thread.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    teardown(app);

    let url = WebviewUrl::App("index.html#/hud".into());
    let win = WebviewWindowBuilder::new(app, HUD_LABEL, url)
        .title("Glint")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        // Do NOT steal focus from the app the user is about to drag into.
        .focused(false)
        .inner_size(HUD_W, HUD_H)
        .visible(false) // shown after it positions to the monitor
        .build()?;

    // Position bottom-LEFT of the primary monitor (CleanShot-style corner).
    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let pos = monitor.position(); // physical px
        let size = monitor.size(); // physical px
        let hud_h = (HUD_H * scale) as i32;
        let margin_x = (MARGIN_X * scale) as i32;
        let margin_y = (MARGIN_Y * scale) as i32;
        let x = pos.x + margin_x;
        let y = pos.y + size.height as i32 - hud_h - margin_y;
        win.set_position(tauri::PhysicalPosition { x, y })?;
    } else {
        log::warn!("hud: no primary monitor; using default window position");
    }

    win.show()?;
    Ok(())
}

/// Close the HUD window if it's open. Safe to call when none exists.
pub fn teardown(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.close();
    }
}
