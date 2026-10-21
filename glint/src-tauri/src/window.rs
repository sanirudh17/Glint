use tauri::{AppHandle, Manager};

/// Show, unminimize and focus the main window, creating focus from any context.
pub fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Disable the Windows DWM open/show transition animation for this window so it appears
/// INSTANTLY instead of fading/scaling in. Set once at build time; the attribute persists
/// for the window's lifetime, so every later show() is animation-free. No-op if the handle
/// or DWM call is unavailable.
///
/// Shared by every transient always-on-top window that is shown on a hot path (capture
/// overlay, post-capture HUD, recorder region selector) — the OS transition otherwise adds
/// a visible beat between the trigger and the window appearing.
#[cfg(windows)]
pub fn disable_transitions(win: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    let raw = match win.window_handle() {
        Ok(h) => h.as_raw(),
        Err(_) => return,
    };
    if let RawWindowHandle::Win32(h) = raw {
        let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
        let on: i32 = 1; // TRUE — force-disable transitions
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                &on as *const i32 as *const core::ffi::c_void,
                std::mem::size_of::<i32>() as u32,
            );
        }
    }
}
#[cfg(not(windows))]
pub fn disable_transitions(_win: &tauri::WebviewWindow) {}

/// Wait for a preceding hide to reach the composed desktop before grabbing it.
/// Call off the event thread, after hiding a window with transitions disabled.
/// Unlike an arbitrary delay, this normally waits only one composition frame.
pub fn wait_for_compositor() {
    #[cfg(windows)]
    if unsafe { windows::Win32::Graphics::Dwm::DwmFlush() }.is_ok() {
        return;
    }
    // Preserve the conservative path when composition is unavailable.
    std::thread::sleep(std::time::Duration::from_millis(200));
}

/// Mark a window as excluded from screen capture (Win10 2004+): it stays visible on
/// screen but is omitted from anything that captures the desktop (gdigrab/ddagrab). Used
/// for the recording control bar and the pre-record countdown so neither is baked into the
/// video. Best-effort — logs and moves on if the handle or the call is unavailable.
#[cfg(windows)]
pub fn exclude_from_capture(win: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };
    let raw = match win.window_handle() {
        Ok(h) => h.as_raw(),
        Err(e) => {
            log::warn!("exclude_from_capture: no window handle: {e}");
            return;
        }
    };
    if let RawWindowHandle::Win32(h) = raw {
        let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
        if let Err(e) = unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) } {
            log::warn!("exclude_from_capture: SetWindowDisplayAffinity failed: {e}");
        }
    }
}
#[cfg(not(windows))]
pub fn exclude_from_capture(_win: &tauri::WebviewWindow) {}
