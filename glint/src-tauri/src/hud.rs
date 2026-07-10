//! The post-capture tray window (Quick Access Overlay) — a persistent, borderless,
//! transparent, always-on-top card stack at the bottom-left of the capture monitor.
//! It accumulates recent captures (see `capture::tray`) and is built once, then
//! stays open, refetching on `tray-updated` and self-resizing via `tray_resize`.
//! It is closed only when the tray empties (dismiss / clear) or on app exit.
//!
//! NOTE: it stays CONTINUOUSLY VISIBLE — never hidden/re-shown. The window
//! intentionally never takes focus, and a focus-less transparent WebView2 window
//! that is hidden and re-shown repeatedly gets its renderer suspended by Windows'
//! occlusion handling and stops repainting after a few cycles. Building once and
//! updating content in place keeps it reliable.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

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

/// Ensure the persistent tray window exists. If it's already open, notify it to
/// refetch (a new capture just landed). Otherwise build it (off the main thread —
/// building a webview synchronously on the main thread deadlocks the event loop;
/// see `capture::begin_spawned`; callers already run on a background thread). It is
/// NOT torn down per capture; it persists and stays continuously visible (a
/// hidden/re-shown focus-less transparent WebView2 gets its renderer suspended —
/// see the module note), sizing itself to its content via `tray_resize`.
pub fn ensure_open(app: &AppHandle) -> tauri::Result<()> {
    // The recording HUD shares this bottom-left corner; a new capture DISPLACES it so the two
    // never sit as separate stacks (symmetric with build_rec_hud tearing this one down).
    crate::recorder::windows::close_rec_hud(app);
    if app.get_webview_window(HUD_LABEL).is_some() {
        let _ = app.emit_to(HUD_LABEL, "tray-updated", ());
        return Ok(());
    }

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
        .inner_size(HUD_W, HUD_H) // initial; the frontend resizes to its content
        .visible(false) // shown after it positions to the monitor
        .build()?;

    // No OS fade/scale-in — the post-capture card should appear the instant it's shown.
    crate::window::disable_transitions(&win);

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

    // Paint handshake: reveal only after the frontend has painted its first frame
    // (`hud-ready`), so WebView2 never flashes its unpainted first frame on this cold
    // build (a brief accent-tinted flash seen only on the first capture; warm reuses
    // never rebuild). 800 ms fallback guarantees the window still shows if the event is
    // missed. Mirrors `build_region_selector`, but NEVER set_focus — the HUD is focus-less
    // by design (it must not steal focus from the app the user is about to drag into).
    use tauri::Listener;
    use std::sync::atomic::{AtomicBool, Ordering};
    let shown = std::sync::Arc::new(AtomicBool::new(false));
    {
        let win = win.clone();
        let shown = shown.clone();
        app.once("hud-ready", move |_| {
            if !shown.swap(true, Ordering::SeqCst) { let _ = win.show(); }
        });
    }
    {
        let win = win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            if !shown.swap(true, Ordering::SeqCst) { let _ = win.show(); }
        });
    }
    Ok(())
}

/// Close the HUD window if it's open. Safe to call when none exists.
pub fn teardown(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(HUD_LABEL) {
        let _ = win.close();
    }
}
