//! The transparent capture overlay window. To keep capture snappy and its timing
//! consistent, the overlay webview is built ONCE (pre-warmed, hidden) and then
//! reused: each capture repositions it, tells the React app to reload the new
//! frozen frame (the `overlay-refresh` event), and shows it. On commit/cancel it
//! is HIDDEN, not closed, so the next capture pays no webview-creation cost.

use std::sync::mpsc;
use std::time::{Duration, Instant};
use tauri::{
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

/// How long the backend waits for the overlay's `overlay-ready` (fetched+decoded)
/// before showing anyway. Warm captures signal in a few tens of ms; the cap
/// guarantees we never regress to a long blank-hidden delay if the signal is slow
/// or absent (e.g. a freshly built window whose listener isn't up yet).
const READY_TIMEOUT: Duration = Duration::from_millis(300);

pub const OVERLAY_PREFIX: &str = "overlay-";

fn build(app: &AppHandle, label: &str, monitor_id: u32) -> tauri::Result<WebviewWindow> {
    let url = WebviewUrl::App(format!("index.html#/overlay?monitor={monitor_id}").into());
    let win = WebviewWindowBuilder::new(app, label, url)
        .title("Glint Capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // shown after it positions to the monitor
        .build()?;
    // Kill the OS fade/scale-in transition so the frozen overlay snaps on screen the
    // instant the shortcut fires (set once — it persists across every reuse show()).
    crate::window::disable_transitions(&win);
    Ok(win)
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

    // Plan A — decode-then-show. Instead of showing immediately and letting the
    // (idle-throttled) webview wake + fetch + decode a multi-MB PNG on the visible
    // critical path (the ~1s cold-idle freeze + flash), we ask the overlay to fetch
    // AND decode the new frozen frame while it is STILL HIDDEN, and wait for its
    // `overlay-ready` before showing. show() then only composites an already-decoded
    // image. This runs on a spawned capture thread (see capture::begin_spawned), so
    // the bounded wait never blocks the main event loop that delivers the signal.
    let (tx, rx) = mpsc::channel::<String>();
    let ready_id = app.once("overlay-ready", move |ev| {
        let _ = tx.send(ev.payload().to_string());
    });

    let waited = Instant::now();
    // Tell the (already-mounted) overlay app to load the new frozen frame. The
    // mount-time fetch only covers the on-demand fallback build; a reused window
    // is already mounted, so this event is what refreshes it each capture.
    let _ = app.emit_to(label.as_str(), "overlay-refresh", ());

    match rx.recv_timeout(READY_TIMEOUT) {
        Ok(payload) => log::info!(
            "overlay ready {payload} [perf] refresh→ready: {}ms",
            waited.elapsed().as_millis()
        ),
        Err(_) => log::warn!(
            "overlay ready TIMEOUT after {}ms — showing anyway [perf]",
            waited.elapsed().as_millis()
        ),
    }
    app.unlisten(ready_id);

    win.show()?;
    win.set_focus()?;
    // Force the crosshair NOW. A window shown under a stationary mouse keeps the OS
    // arrow until the pointer moves, because Windows only re-evaluates the CSS cursor on
    // WM_SETCURSOR (i.e. movement) — so the overlay's `cursor: crosshair` looked laggy on
    // press. Setting the native cursor calls SetCursor immediately; the CSS cursor then
    // takes over seamlessly (also crosshair) once the mouse moves.
    let _ = win.set_cursor_icon(tauri::CursorIcon::Crosshair);
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
