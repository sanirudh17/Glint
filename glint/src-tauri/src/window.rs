use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};
static MAIN_READY: AtomicBool = AtomicBool::new(false);

#[tauri::command]
pub fn main_present(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only main can present this window".into());
    }
    if MAIN_READY.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if window
        .app_handle()
        .get_webview_window("editor")
        .is_some_and(|editor| editor.is_visible().unwrap_or(false))
    {
        return Ok(());
    }
    focus_main(window.app_handle());
    Ok(())
}

/// Show, unminimize and focus the main window, creating focus from any context.
pub fn focus_main(app: &AppHandle) {
    if !MAIN_READY.load(Ordering::SeqCst) {
        return;
    }

    if let Some(win) = app.get_webview_window("main") {
        disable_transitions(&win);
        // Restore the retained surface before exposing a hidden window. Showing
        // a still-minimized WebView first can expose an unpainted resize surface.
        if win.is_minimized().unwrap_or(false) {
            let _ = win.unminimize();
        }
        let _ = win.show();
        let _ = win.set_focus();
    }
}

/// Disable the Windows DWM open/show transition animation for this window so it appears
/// instantly instead of fading/scaling in. Persistent windows re-enable this
/// attribute for maximize/restore. No-op if the handle
/// or DWM call is unavailable.
///
/// Shared by every transient always-on-top window that is shown on a hot path (capture
/// overlay, post-capture HUD, recorder region selector) — the OS transition otherwise adds
/// a visible beat between the trigger and the window appearing.
#[cfg(windows)]
fn set_transitions_disabled(win: &tauri::WebviewWindow, disabled: bool) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED};
    let raw = match win.window_handle() {
        Ok(h) => h.as_raw(),
        Err(_) => return,
    };
    if let RawWindowHandle::Win32(h) = raw {
        let hwnd = HWND(h.hwnd.get() as *mut core::ffi::c_void);
        let on: i32 = disabled as i32;
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
fn set_transitions_disabled(_win: &tauri::WebviewWindow, _disabled: bool) {}

/// Overlays should snap in, while persistent app windows use Windows animations.
pub fn disable_transitions(win: &tauri::WebviewWindow) {
    set_transitions_disabled(win, true);
}

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

/// Keep the desktop material active while visible, using Typr's paint guard.
/// Minimized/hidden windows deactivate normally so reopening samples a fresh scene.
#[cfg(windows)]
pub fn protect_desktop_surface(window: &tauri::WebviewWindow) {
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{IsIconic, IsWindowVisible},
        },
    };
    unsafe extern "system" fn procedure(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        hidden: usize,
    ) -> LRESULT {
        if message == 0x0014 {
            return LRESULT(1);
        } // WM_ERASEBKGND
        if message == 0x0086 {
            // WM_NCACTIVATE
            let keep_active = hidden == 0
                && unsafe { IsWindowVisible(hwnd).as_bool() }
                && !unsafe { IsIconic(hwnd).as_bool() };
            return unsafe {
                DefSubclassProc(
                    hwnd,
                    message,
                    if keep_active { WPARAM(1) } else { wparam },
                    lparam,
                )
            };
        }
        if message == 0x0005 || message == 0x0018 {
            // WM_SIZE / WM_SHOWWINDOW
            // SIZE_MINIMIZED is 1. SIZE_MAXIMIZED (2) is still visible acrylic.
            let hidden = if message == 0x0005 {
                wparam.0 == 1
            } else {
                wparam.0 == 0
            };
            unsafe {
                let _ = SetWindowSubclass(hwnd, Some(procedure), id, usize::from(hidden));
            }
        }
        if message == 0x0013 || (message == 0x0018 && wparam.0 != 0 && hidden != 0) {
            unsafe {
                set_native_transitions(hwnd, true);
            }
        }
        if message == 0x0112 && matches!(wparam.0 & 0xfff0, 0xf020 | 0xf030 | 0xf120) {
            let reopening = wparam.0 & 0xfff0 != 0xf020 && unsafe { IsIconic(hwnd).as_bool() };
            unsafe {
                set_native_transitions(hwnd, reopening);
            }
        }
        if message == 0x0082 {
            unsafe {
                let _ = RemoveWindowSubclass(hwnd, Some(procedure), id);
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }
    unsafe fn set_native_transitions(hwnd: HWND, disabled: bool) {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
        };
        let flag = i32::from(disabled);
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_TRANSITIONS_FORCEDISABLED,
                (&flag as *const i32).cast(),
                4,
            );
        }
    }
    let owned = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(hwnd) = owned.hwnd() {
            if !unsafe { SetWindowSubclass(hwnd, Some(procedure), 0x474c494e, 1).as_bool() } {
                log::warn!("Could not install desktop surface protection");
            }
        }
    });
}
#[cfg(not(windows))]
pub fn protect_desktop_surface(_: &tauri::WebviewWindow) {}

/// Native resize animations are independent of the stable tray-opening path.
#[tauri::command]
pub fn window_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if !matches!(window.label(), "main" | "editor" | "rec-trim" | "rec-notes") {
        return Err("This window cannot be maximized".into());
    }
    if window.is_visible().unwrap_or(false) {
        window.show().map_err(|e| e.to_string())?;
    }
    set_transitions_disabled(&window, false);
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize()
    } else {
        window.maximize()
    }
    .map_err(|e| e.to_string())
}
