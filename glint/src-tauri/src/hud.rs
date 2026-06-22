//! The post-capture HUD window — a single transient, borderless, transparent,
//! always-on-top bar at the bottom-centre of the capture monitor. Owned by
//! tray-core exactly like the capture overlay: always torn down on the next
//! capture and on dismiss so no orphan window is ever left behind.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const HUD_LABEL: &str = "hud";

// Logical (CSS px) size of the HUD window. The bar inside has its own inset, so
// the window carries a little transparent breathing room around it.
const HUD_W: f64 = 400.0;
const HUD_H: f64 = 112.0;
// Gap between the HUD and the bottom edge of the monitor.
const MARGIN: f64 = 24.0;

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

    // Position bottom-centre of the primary monitor (single-monitor phase).
    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let pos = monitor.position(); // physical px
        let size = monitor.size(); // physical px
        let hud_w = (HUD_W * scale) as i32;
        let hud_h = (HUD_H * scale) as i32;
        let margin = (MARGIN * scale) as i32;
        let x = pos.x + (size.width as i32 - hud_w) / 2;
        let y = pos.y + size.height as i32 - hud_h - margin;
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
