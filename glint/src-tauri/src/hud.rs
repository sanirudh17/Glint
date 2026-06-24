//! The post-capture HUD window — a single borderless, transparent, always-on-top
//! card at the bottom-left of the capture monitor. Like the capture overlay, the
//! HUD webview is built ONCE (pre-warmed, hidden) and reused: each capture
//! repositions it, tells the React app to reload the new result (`hud-refresh`),
//! and shows it WITHOUT stealing focus (the user may be about to drag into another
//! app). On dismiss it is HIDDEN, not closed, so the next capture pays no
//! webview-creation cost.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const HUD_LABEL: &str = "hud";

// Logical (CSS px) size of the HUD window. It holds a corner thumbnail card with
// transparent breathing room around it for the seat shadow.
const HUD_W: f64 = 244.0;
const HUD_H: f64 = 172.0;
// Gap from the monitor's left edge.
const MARGIN_X: f64 = 20.0;
// Gap from the monitor's bottom edge — generous so the card clears the Windows
// taskbar (precise work-area insetting is a later polish pass).
const MARGIN_Y: f64 = 48.0;

fn build(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App("index.html#/hud".into());
    WebviewWindowBuilder::new(app, HUD_LABEL, url)
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
        .build()
}

/// Build the HUD window once, hidden, so the first capture's HUD doesn't pay the
/// webview-creation cost. Idempotent. Safe from a spawned thread.
pub fn prewarm(app: &AppHandle) {
    if app.get_webview_window(HUD_LABEL).is_some() {
        return;
    }
    if let Err(e) = build(app) {
        log::warn!("hud prewarm failed (will build on demand): {e}");
    }
}

/// Show the HUD for the current capture result. Reuses the pre-warmed window when
/// present; builds on demand otherwise. Must run off the main thread — building a
/// webview synchronously on the main thread deadlocks the event loop (see
/// `capture::begin_spawned`). It's called from `finish_commit`, already on a
/// background thread.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    let win = match app.get_webview_window(HUD_LABEL) {
        Some(w) => w,
        None => build(app)?,
    };

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

    // Tell the (already-mounted) HUD app to load the new capture result. The
    // mount-time fetch only covers the on-demand fallback build.
    let _ = app.emit_to(HUD_LABEL, "hud-refresh", ());

    // Show WITHOUT set_focus — the HUD must never steal focus from the foreground
    // app (the user may be about to drag the thumbnail into it).
    win.show()?;
    Ok(())
}

/// Hide the HUD window (kept alive for reuse — never closed). Safe to call when
/// none exists.
pub fn teardown(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.hide();
    }
}
