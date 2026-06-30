//! Off-thread window builders for recorder UI: the floating control bar and
//! the 3·2·1 countdown overlay. Pattern mirrors hud.rs / pin.rs — both are
//! called from async (`#[tauri::command(async)]`) contexts, which keeps the
//! builds off the main thread and avoids the WebView2 deadlock.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const BAR_LABEL: &str = "rec-bar";
pub const COUNTDOWN_LABEL: &str = "rec-countdown";

/// Bottom-center floating control bar. Interactive but focus-less (pin pattern).
pub fn build_control_bar(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(BAR_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(
        app,
        BAR_LABEL,
        WebviewUrl::App("index.html#/rec-bar".into()),
    )
    .title("Glint Recording")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .focused(false)
    .inner_size(280.0, 44.0)
    .visible(false)
    .build()?;

    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let bar_w = (280.0 * s) as i32;
        let bar_h = (44.0 * s) as i32;
        let x = pos.x + (size.width as i32 - bar_w) / 2;
        let y = pos.y + size.height as i32 - bar_h - (60.0 * s) as i32;
        win.set_position(tauri::PhysicalPosition { x, y })?;
    } else {
        log::warn!("rec-bar: no primary monitor; using default window position");
    }

    win.show()?;
    exclude_from_capture(&win);
    Ok(())
}

/// Mark a window as excluded from screen capture (Win10 2004+). The control bar
/// must stay visible on screen yet never appear in the recorded video — gdigrab
/// BitBlt-captures the desktop, and WDA_EXCLUDEFROMCAPTURE omits this window from
/// that capture while leaving it on screen. Best-effort: logs and moves on if the
/// handle or the call is unavailable (the bar simply shows in the video then).
fn exclude_from_capture(win: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };
    let raw = match win.window_handle() {
        Ok(h) => h.as_raw(),
        Err(e) => {
            log::warn!("rec-bar: no window handle for capture-exclusion: {e}");
            return;
        }
    };
    if let RawWindowHandle::Win32(h) = raw {
        let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
        if let Err(e) = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) } {
            log::warn!("rec-bar: SetWindowDisplayAffinity failed: {e}");
        }
    }
}

/// Close the control bar if it is open. Safe to call when none exists.
pub fn close_control_bar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(BAR_LABEL) {
        let _ = w.close();
    }
}

/// Fullscreen, centered, click-through countdown. Closes itself at 0.
pub fn build_countdown(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(COUNTDOWN_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(
        app,
        COUNTDOWN_LABEL,
        WebviewUrl::App("index.html#/rec-countdown".into()),
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
    win.show()?;
    Ok(())
}

/// Close the countdown overlay if it is open. Rust owns the teardown so the digit
/// is gone before capture begins (it must never bleed into the first frames) and a
/// countdown webview that failed to self-close can't be left orphaned. Safe to call
/// when none exists.
pub fn close_countdown(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = w.close();
    }
}

pub const REC_HUD_LABEL: &str = "rec-hud";

/// Post-recording HUD — a small focus-less, transparent, always-on-top card at the
/// bottom-left of the primary monitor (mirrors the screenshot HUD's corner). Shows
/// the finished recording's thumbnail + quick actions. Built fresh each time; tears
/// down any prior HUD first. Recording is already stopped, so it isn't excluded from
/// capture.
pub fn build_rec_hud(app: &AppHandle) -> tauri::Result<()> {
    close_rec_hud(app);
    let win = WebviewWindowBuilder::new(app, REC_HUD_LABEL, WebviewUrl::App("index.html#/rec-hud".into()))
        .title("Glint Recording")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(244.0, 172.0)
        .visible(false)
        .build()?;

    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let hud_h = (172.0 * s) as i32;
        let x = pos.x + (20.0 * s) as i32;
        let y = pos.y + size.height as i32 - hud_h - (48.0 * s) as i32;
        win.set_position(tauri::PhysicalPosition { x, y })?;
    } else {
        log::warn!("rec-hud: no primary monitor; using default window position");
    }

    win.show()?;
    Ok(())
}

/// Close the post-recording HUD if it is open. Safe to call when none exists.
pub fn close_rec_hud(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(REC_HUD_LABEL) {
        let _ = w.close();
    }
}

pub const SELECT_LABEL: &str = "rec-select";

/// Full-screen, transparent, LIVE (non-frozen) region selector. Takes focus so it
/// gets pointer + Esc. Covers the primary monitor.
pub fn build_region_selector(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(SELECT_LABEL).is_some() { return Ok(()); }
    let win = WebviewWindowBuilder::new(app, SELECT_LABEL, WebviewUrl::App("index.html#/rec-select".into()))
        .title("Glint Select Region").decorations(false).transparent(true)
        .always_on_top(true).skip_taskbar(true).resizable(false).shadow(false)
        .focused(true).visible(false).build()?;
    if let Some(m) = win.primary_monitor()? {
        let pos = m.position(); let size = m.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    win.show()?; win.set_focus()?;
    Ok(())
}

/// Close the region selector if it is open. Rust owns this teardown: the selector
/// must NOT close itself before invoking `recorder_start` (closing destroys its
/// webview's JS context, so the IPC never fires), and a full-screen recording
/// would otherwise capture the transparent overlay. Safe to call when none exists.
pub fn close_region_selector(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SELECT_LABEL) {
        let _ = w.close();
    }
}
