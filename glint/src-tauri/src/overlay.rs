//! Per-monitor transparent capture overlay windows. Always tear down via teardown_all
//! on every exit path so no invisible click-blocking window is ever left behind.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_PREFIX: &str = "overlay-";

pub fn open_for_monitor(app: &AppHandle, monitor_id: u32) -> tauri::Result<()> {
    let label = format!("{OVERLAY_PREFIX}{monitor_id}");
    if app.get_webview_window(&label).is_some() {
        return Ok(()); // already open
    }
    let url = WebviewUrl::App(format!("index.html#/overlay?monitor={monitor_id}").into());
    let win = WebviewWindowBuilder::new(app, &label, url)
        .title("Glint Capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // shown after it positions to the monitor
        .build()?;

    // Cover the primary monitor (single-monitor phase). Multi-monitor: position per monitor.
    if let Some(monitor) = win.primary_monitor()? {
        let pos = monitor.position();
        let size = monitor.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    win.set_fullscreen(true)?;
    win.show()?;
    win.set_focus()?;
    Ok(())
}

pub fn teardown_all(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(OVERLAY_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}
