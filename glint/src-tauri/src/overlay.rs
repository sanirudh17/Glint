//! The transparent capture overlay window. To keep capture snappy and its timing
//! consistent, the overlay webview is built ONCE (pre-warmed, hidden) and then
//! reused: each capture repositions it, tells the React app to reload the new
//! frozen frame (the `overlay-refresh` event), and shows it. On commit/cancel it
//! is HIDDEN, not closed, so the next capture pays no webview-creation cost.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const OVERLAY_PREFIX: &str = "overlay-";

fn build(app: &AppHandle, label: &str, monitor_id: u32) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App(format!("index.html#/overlay?monitor={monitor_id}").into());
    WebviewWindowBuilder::new(app, label, url)
        .title("Glint Capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // shown after it positions to the monitor
        .build()
}

/// Build the overlay window once, hidden, so the first capture doesn't pay the
/// webview-creation cost (the dominant source of the open delay). Idempotent —
/// a no-op if it already exists. Safe to call from a spawned thread (the proven
/// off-main-thread build path; see `capture::begin_spawned`).
pub fn prewarm(app: &AppHandle, monitor_id: u32) {
    let label = format!("{OVERLAY_PREFIX}{monitor_id}");
    if app.get_webview_window(&label).is_some() {
        return;
    }
    if let Err(e) = build(app, &label, monitor_id) {
        log::warn!("overlay prewarm failed (will build on demand): {e}");
    }
}

pub fn open_for_monitor(app: &AppHandle, monitor_id: u32) -> tauri::Result<()> {
    let label = format!("{OVERLAY_PREFIX}{monitor_id}");
    // Reuse the pre-warmed window when present; build on demand as a fallback.
    let win = match app.get_webview_window(&label) {
        Some(w) => w,
        None => build(app, &label, monitor_id)?,
    };

    // Cover the primary monitor by manual position+size (single-monitor phase).
    // We deliberately do NOT call set_fullscreen(true): on Windows, OS fullscreen
    // on a borderless transparent always-on-top window can drop the transparency
    // (black fill) or fight the manual geometry. A borderless window sized to the
    // monitor with always_on_top is the correct "fullscreen overlay".
    if let Some(monitor) = win.primary_monitor()? {
        let pos = monitor.position();
        let size = monitor.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize {
            width: size.width,
            height: size.height,
        })?;
    } else {
        log::warn!("overlay: no primary monitor; using default window geometry");
    }

    // Tell the (already-mounted) overlay app to load the new frozen frame. The
    // mount-time fetch only covers the on-demand fallback build; a reused window
    // is already mounted, so this event is what refreshes it each capture.
    let _ = app.emit_to(label.as_str(), "overlay-refresh", ());

    win.show()?;
    win.set_focus()?;
    Ok(())
}

/// Hide every overlay window (kept alive for reuse — never closed). Always called
/// on every capture exit path so no visible click-blocking overlay is left behind.
pub fn teardown_all(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(OVERLAY_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.hide();
        }
    }
}
