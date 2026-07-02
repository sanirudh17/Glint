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
    .inner_size(280.0, 80.0)
    .visible(false)
    .build()?;

    // Height leaves room above the pill for its hover tooltip; the frontend then
    // resizes the width to fit the pill exactly (ControlBar's ResizeObserver).
    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor();
        let pos = m.position();
        let size = m.size();
        let bar_w = (280.0 * s) as i32;
        let bar_h = (80.0 * s) as i32;
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

pub const CAM_LABEL: &str = "rec-cam";

/// Live webcam bubble — a focus-less, transparent, always-on-top circular window
/// rendering the default camera. Unlike the control bar it is NOT excluded from
/// capture: gdigrab records it as part of the screen. Positioned bottom-right of
/// the recording area so it starts inside a region recording.
pub fn build_cam_bubble(app: &AppHandle, target: crate::recorder::RecordTarget, diameter: f64) -> tauri::Result<()> {
    if app.get_webview_window(CAM_LABEL).is_some() {
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, CAM_LABEL, WebviewUrl::App("index.html#/rec-cam".into()))
        .title("Glint Camera")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(diameter, diameter)
        .visible(false)
        .build()?;

    if let Some(m) = win.primary_monitor()? {
        let s = m.scale_factor();
        // Recording area in PHYSICAL px (region coords are physical; fullscreen = monitor).
        let (rx, ry, rw, rh) = match target {
            crate::recorder::RecordTarget::Region { x, y, w, h } => (x, y, w as i32, h as i32),
            crate::recorder::RecordTarget::Fullscreen => {
                let pos = m.position();
                let size = m.size();
                (pos.x, pos.y, size.width as i32, size.height as i32)
            }
        };
        let d = (diameter * s) as i32;
        let margin = (24.0 * s) as i32;
        let x = rx + rw - d - margin;
        let mut y = ry + rh - d - margin;
        // Keep the bubble above the taskbar: clamp its bottom to the primary
        // monitor's WORK AREA. For a fullscreen recording the area is the whole
        // monitor (taskbar included), so an un-clamped bottom-right lands the
        // bubble under the taskbar where it can't be seen or dragged.
        if let Some(wa) = primary_work_area() {
            let max_y = wa.bottom - d - margin;
            if y > max_y {
                y = max_y;
            }
        }
        win.set_position(tauri::PhysicalPosition { x, y })?;
    } else {
        log::warn!("rec-cam: no primary monitor; default position");
    }

    win.show()?;
    Ok(())
}

/// Primary monitor work area (screen minus the taskbar) in physical pixels.
/// Used to keep the webcam bubble above the taskbar. Best-effort: returns None
/// if the Win32 call fails, in which case the caller keeps the un-clamped pos.
fn primary_work_area() -> Option<windows::Win32::Foundation::RECT> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };
    let mut rect = RECT::default();
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETWORKAREA,
            0,
            Some(&mut rect as *mut _ as *mut core::ffi::c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
    };
    ok.is_ok().then_some(rect)
}

/// Close the webcam bubble if open. Safe when none exists.
///
/// Uses `destroy()`, not `close()`: `close()` fires CloseRequested and defers the
/// actual teardown to the webview's JS, which proved unreliable for this transparent,
/// focus-less bubble — it lingered on screen after stop (a black circle, still
/// captured) and blocked re-enabling, since `build_cam_bubble` early-returns while the
/// label still exists. `destroy()` force-tears it down immediately and releases the
/// camera with the webview.
pub fn close_cam_bubble(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(CAM_LABEL) {
        let _ = w.destroy();
    }
}

pub const TRIM_LABEL: &str = "rec-trim";

/// The trim / quick-edit window: a NORMAL decorated, focused, resizable app window
/// (unlike the transparent recorder overlays). Built off the main thread (async
/// command) per the window-build rule. Single instance — focus if already open.
pub fn build_trim_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(TRIM_LABEL) {
        let _ = w.set_focus();
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, TRIM_LABEL, WebviewUrl::App("index.html#/rec-trim".into()))
        .title("Glint — Trim Recording")
        .decorations(true)
        .resizable(true)
        .inner_size(900.0, 600.0)
        .min_inner_size(640.0, 460.0)
        .center()
        .visible(true)
        .build()?;
    let _ = win.set_focus();
    Ok(())
}

/// Close the trim window if open.
pub fn close_trim_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(TRIM_LABEL) {
        let _ = w.close();
    }
}
