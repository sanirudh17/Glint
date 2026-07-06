//! Off-thread window builders for recorder UI: the floating control bar and
//! the 3·2·1 countdown overlay. Pattern mirrors hud.rs / pin.rs — both are
//! called from async (`#[tauri::command(async)]`) contexts, which keeps the
//! builds off the main thread and avoids the WebView2 deadlock.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

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
pub(crate) fn exclude_from_capture(win: &tauri::WebviewWindow) {
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
    // The screenshot tray and the recording HUD share the same bottom-left corner and must
    // never coexist as two separate stacks — a new recording HUD DISPLACES the screenshot
    // tray (its in-memory stack persists and reappears on the next screenshot). This is the
    // capture side of the mutual-exclusion; the screenshot path closes this HUD symmetrically.
    crate::hud::teardown(app);
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

/// Build the (hidden) full-screen, transparent, LIVE region selector window. Takes focus
/// so it gets pointer + Esc. Covers the primary monitor. Not shown here — callers decide.
fn build_selector_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let win = WebviewWindowBuilder::new(app, SELECT_LABEL, WebviewUrl::App("index.html#/rec-select".into()))
        .title("Glint Select Region").decorations(false).transparent(true)
        .always_on_top(true).skip_taskbar(true).resizable(false).shadow(false)
        .focused(true).visible(false).build()?;
    cover_primary_monitor(&win)?;
    Ok(win)
}

/// Size + position the window to fill the primary monitor at its physical origin.
fn cover_primary_monitor(win: &WebviewWindow) -> tauri::Result<()> {
    if let Some(m) = win.primary_monitor()? {
        let pos = m.position(); let size = m.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    Ok(())
}

/// Build the region selector once, hidden + mounted, at startup so the first Record press
/// doesn't pay the WebView2 cold-start (the dominant open delay). Idempotent — a no-op if
/// it already exists. Safe from a spawned thread (mirrors `overlay::prewarm`). The selector
/// takes focus on show, so — like the capture overlay — it is safe to keep alive and reuse
/// (the focus-less HUD is the one that must not be).
pub fn prewarm_region_selector(app: &AppHandle) {
    if app.get_webview_window(SELECT_LABEL).is_some() { return; }
    if let Err(e) = build_selector_window(app) {
        log::warn!("region selector prewarm failed (will build on demand): {e}");
    }
}

/// Show the region selector. Reuses the pre-warmed window when present — instant, no cold
/// load, and it was reset to a clean state when last hidden (so no stale frame). A reset
/// event re-seeds its chips from the latest settings. Falls back to an on-demand build with
/// a paint handshake (reveal only after the frontend emits `rec-select-ready`, 800 ms
/// fallback) so a cold build never flashes the stale frame WebView2 holds from last time.
pub fn build_region_selector(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SELECT_LABEL) {
        cover_primary_monitor(&win)?; // monitor / DPI may have changed since prewarm
        let _ = app.emit_to(SELECT_LABEL, "rec-select-reset", ());
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    let win = build_selector_window(app)?;
    use tauri::Listener;
    use std::sync::atomic::{AtomicBool, Ordering};
    let shown = std::sync::Arc::new(AtomicBool::new(false));
    {
        let win = win.clone();
        let shown = shown.clone();
        app.once("rec-select-ready", move |_| {
            if !shown.swap(true, Ordering::SeqCst) { let _ = win.show(); let _ = win.set_focus(); }
        });
    }
    {
        let win = win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            if !shown.swap(true, Ordering::SeqCst) { let _ = win.show(); let _ = win.set_focus(); }
        });
    }
    Ok(())
}

/// HIDE the region selector (kept alive for reuse — never closed) and reset it to a clean
/// state so the next open shows no leftover region. Rust owns this teardown: the selector
/// must NOT close itself before invoking `recorder_start` (closing destroys its webview's
/// JS context, so the IPC never fires), and a hidden window is never captured by a
/// full-screen recording. Safe to call when none exists.
pub fn close_region_selector(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(SELECT_LABEL) {
        let _ = w.hide();
        let _ = app.emit_to(SELECT_LABEL, "rec-select-reset", ());
    }
}

pub const CAM_LABEL: &str = "rec-cam";

/// Live webcam bubble — a focus-less, transparent, always-on-top circular window
/// rendering the default camera. In baked-in mode it is NOT excluded from capture:
/// gdigrab records it as part of the screen. In `movable` mode it IS excluded, so the
/// screen video is clean and the camera is recorded separately (composited later).
/// Positioned bottom-right of the recording area so it starts inside a region recording.
///
/// Returns the bubble's placement NORMALIZED to the recorded frame as `(x, y, diameter)` in
/// 0..1 (top-left + diameter/frame-width), so a movable recording can persist it and the trim
/// editor can start its overlay exactly where the webcam was. `None` if no monitor / the
/// bubble already exists.
pub fn build_cam_bubble(app: &AppHandle, target: crate::recorder::RecordTarget, diameter: f64, movable: bool, shape: &str) -> tauri::Result<Option<(f64, f64, f64)>> {
    if app.get_webview_window(CAM_LABEL).is_some() {
        return Ok(None);
    }
    // circle/square are 1:1; rounded/rect show the full webcam frame at 16:9 (the window is
    // shaped so gdigrab bakes the true shape and the live preview matches).
    let bubble_h = if matches!(shape, "rounded" | "rect") { diameter * 9.0 / 16.0 } else { diameter };
    let win = WebviewWindowBuilder::new(app, CAM_LABEL, WebviewUrl::App("index.html#/rec-cam".into()))
        .title("Glint Camera")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(diameter, bubble_h)
        .visible(false)
        .build()?;

    let mut placement = None;
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
        let dh = (bubble_h * s) as i32;
        let margin = (24.0 * s) as i32;
        let x = rx + rw - d - margin;
        let mut y = ry + rh - dh - margin;
        // Keep the bubble above the taskbar: clamp its bottom to the primary
        // monitor's WORK AREA. For a fullscreen recording the area is the whole
        // monitor (taskbar included), so an un-clamped bottom-right lands the
        // bubble under the taskbar where it can't be seen or dragged.
        if let Some(wa) = primary_work_area() {
            let max_y = wa.bottom - dh - margin;
            if y > max_y {
                y = max_y;
            }
        }
        win.set_position(tauri::PhysicalPosition { x, y })?;
        // Normalize to the recorded frame so the trim overlay starts here at the same size.
        // `diameter` is the box WIDTH (the trim editor derives height from the shape aspect).
        if rw > 0 && rh > 0 {
            placement = Some((
                (x - rx) as f64 / rw as f64,
                (y - ry) as f64 / rh as f64,
                d as f64 / rw as f64,
            ));
        }
    } else {
        log::warn!("rec-cam: no primary monitor; default position");
    }

    // Movable mode: hide the bubble from gdigrab/ddagrab so the screen video is clean —
    // the webcam is recorded separately and composited later in the trim editor.
    if movable {
        exclude_from_capture(&win);
    }

    win.show()?;
    Ok(placement)
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
        // Open maximized so the preview + timeline get the full screen — a 900×600 window
        // is cramped for scrubbing. Still a normal decorated window the user can un-maximize.
        .maximized(true)
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
