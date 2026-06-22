pub mod commands;
pub mod frozen;
pub mod geometry;
pub mod windows_enum;

use crate::overlay;
use frozen::{CapturedImage, ScreenCapturer, XcapCapturer};
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use windows_enum::WindowInfo;

#[derive(Clone, Copy, Debug)]
pub enum CaptureMode {
    Area,
    Fullscreen,
    Window,
}

impl FromStr for CaptureMode {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, ()> {
        match s {
            "area" => Ok(CaptureMode::Area),
            "fullscreen" => Ok(CaptureMode::Fullscreen),
            "window" => Ok(CaptureMode::Window),
            _ => Err(()),
        }
    }
}

impl CaptureMode {
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureMode::Area => "area",
            CaptureMode::Fullscreen => "fullscreen",
            CaptureMode::Window => "window",
        }
    }
}

pub struct CaptureSession {
    // Kept for the per-monitor architecture; the single-monitor P2 path always
    // uses the primary (id 0) and commands clamp against the session image.
    #[allow(dead_code)]
    pub monitor_id: u32,
    pub image: CapturedImage,
    pub scale: f64,
    pub windows: Vec<WindowInfo>,
    pub mode: CaptureMode,
    /// True when this capture was started from the main-window UI (a quick-start
    /// button), which hid the main window first. On commit/cancel the commands
    /// re-show + focus the main window so it (and its taskbar icon) returns.
    /// False for hotkey/tray captures, which never touched the main window.
    pub restore_main: bool,
}

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<CaptureSession>>);

/// Spawn [`begin`] on a fresh background thread.
///
/// Building the overlay `WebviewWindow` must NOT happen synchronously on the
/// main thread: sync Tauri commands and tray menu-event handlers run on the
/// main thread, and creating a webview there deadlocks the Windows event loop
/// (the build waits on the loop that is busy running the handler). Every
/// main-thread trigger MUST route through this so the build runs off-thread,
/// where the event loop is free to service it.
pub fn begin_spawned(app: &AppHandle, mode: CaptureMode) {
    let app = app.clone();
    std::thread::spawn(move || begin(&app, mode));
}

/// Entry point from hotkeys / tray. Leaves the main window untouched.
pub fn begin(app: &AppHandle, mode: CaptureMode) {
    begin_restoring(app, mode, false);
}

/// Begin a capture, recording whether the main window should be re-shown when the
/// capture settles. `restore_main` is true only for the main-window quick-start
/// buttons (which hid the main window first). Never panics; logs + toasts on
/// failure. Must run off the main thread (see [`begin_spawned`]).
pub fn begin_restoring(app: &AppHandle, mode: CaptureMode, restore_main: bool) {
    log::info!("capture begin: mode={}", mode.as_str());
    // Guard against double-begin: tear down any existing overlay first.
    overlay::teardown_all(app);

    let capturer = XcapCapturer;
    let image = match capturer.capture_primary() {
        Ok(img) => img,
        Err(e) => {
            log::error!("capture failed: {e}");
            toast(app, "Couldn't capture screen");
            return;
        }
    };
    log::info!("captured frozen frame: {}x{}", image.width, image.height);

    let monitor_id: u32 = 0; // single-monitor phase: primary keyed as 0

    // AppHandle::primary_monitor() exists in Tauri 2.11.3 (confirmed in app.rs:870).
    // Returns crate::Result<Option<Monitor>>; Monitor::scale_factor(&self) -> f64.
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let windows = if matches!(mode, CaptureMode::Window) {
        windows_enum::list_windows()
    } else {
        Vec::new()
    };

    *app.state::<CaptureState>().0.lock().unwrap() = Some(CaptureSession {
        monitor_id,
        image,
        scale,
        windows,
        mode,
        restore_main,
    });

    match overlay::open_for_monitor(app, monitor_id) {
        Ok(()) => log::info!("capture overlay opened (scale={scale})"),
        Err(e) => {
            log::error!("overlay open failed: {e}");
            overlay::teardown_all(app);
            *app.state::<CaptureState>().0.lock().unwrap() = None;
            toast(app, "Couldn't open capture overlay");
        }
    }
}

pub(crate) fn toast(app: &AppHandle, msg: &str) {
    let _ = app.emit("glint-toast", msg);
}

/// Re-show + focus the main window. Called when a capture that was started from
/// the main-window UI settles, so the window (and its taskbar icon) returns and
/// the success toast lands somewhere visible.
pub(crate) fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn parses_modes() {
        assert!(matches!(CaptureMode::from_str("area"), Ok(CaptureMode::Area)));
        assert!(matches!(CaptureMode::from_str("window"), Ok(CaptureMode::Window)));
        assert!(matches!(CaptureMode::from_str("fullscreen"), Ok(CaptureMode::Fullscreen)));
        assert!(CaptureMode::from_str("nope").is_err());
    }
}
