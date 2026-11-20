//! Compositor-owned desktop acrylic, matching Seek's material. Capture overlays
//! deliberately never receive a window-wide backdrop or a changed affinity.
use tauri::{Emitter, Manager, WebviewWindow};

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
#[derive(Clone, Copy)]
struct Surface {
    applied: bool,
    dark: bool,
    pending: bool,
    token: u64,
    prepared: bool,
}
static NEXT_REVEAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static SURFACES: LazyLock<Mutex<HashMap<String, Surface>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
fn opaque(dark: bool) -> tauri::window::Color {
    if dark {
        tauri::window::Color(8, 8, 8, 255)
    } else {
        tauri::window::Color(246, 247, 249, 255)
    }
}
fn persistent(label: &str) -> bool {
    matches!(label, "main" | "editor" | "rec-trim" | "rec-notes" | "ocr")
}
pub fn request_paint(window: &WebviewWindow) {
    let _ = window.emit("desktop-present", ());
}
#[tauri::command]
pub fn window_material(
    window: WebviewWindow,
    glass: bool,
    dark: bool,
    system: Option<bool>,
) -> bool {
    if !persistent(window.label()) {
        return false;
    }
    let glass = glass && !window_power_saver();
    let _ = window.set_theme(if system.unwrap_or(false) {
        None
    } else {
        Some(if dark {
            tauri::Theme::Dark
        } else {
            tauri::Theme::Light
        })
    });
    // Never expose an uninitialized desktop backdrop during activation.
    let _ = window.set_background_color(Some(opaque(dark)));
    let applied = apply(&window, glass, dark);
    let pending = applied
        && (!window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false));
    let mut surfaces = SURFACES.lock().unwrap();
    let previous = surfaces.get(window.label()).copied();
    surfaces.insert(
        window.label().into(),
        Surface {
            applied,
            dark,
            pending: previous.is_some_and(|s| s.pending) || pending,
            token: previous.map_or(0, |s| s.token),
            prepared: false,
        },
    );
    drop(surfaces);
    if applied && !pending {
        let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    }
    applied
}
/// Restore a previously hidden surface without exposing the inactive white fallback.
pub fn prepare_reveal(window: &WebviewWindow) {
    if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
        return;
    }
    gate_reveal(window);
}
/// A taskbar restore of a minimized persistent window. Windows restores it
/// outside our show path, so the wndproc enters the same gate right before the
/// restore: cloaked until a fresh frame and an active backdrop are ready.
/// Returns false (no cloak) if the bookkeeping is busy, leaving a plain restore.
pub fn gate_taskbar_restore(window: &WebviewWindow) -> bool {
    if !persistent(window.label()) || SURFACES.try_lock().is_err() {
        return false;
    }
    gate_reveal(window);
    true
}
fn gate_reveal(window: &WebviewWindow) {
    // Reopening during a close cancels that close's pending fallback hide.
    RETIRING.lock().unwrap().remove(window.label());
    // Carbon's gate: acquire the physical cloak BEFORE ShowWindow. Keep the
    // native window visible behind it so WebView2 can submit fresh frames.
    let cloaked = set_cloaked(window, true);
    let token = NEXT_REVEAL.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let state = {
        let mut surfaces = SURFACES.lock().unwrap();
        let state = surfaces.entry(window.label().into()).or_insert(Surface {
            applied: false,
            dark: true,
            pending: false,
            token: 0,
            prepared: false,
        });
        state.pending = cloaked;
        state.token = token;
        state.prepared = false;
        *state
    };
    let _ = window.set_background_color(Some(opaque(state.dark)));
    // A renderer failure must not strand a cloaked, focused window forever.
    // Recover with a themed SOLID surface, never an unpainted glass reveal.
    let win = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let app = win.app_handle().clone();
        let _ = app.run_on_main_thread(move || {
            let mut surfaces = SURFACES.lock().unwrap();
            if let Some(state) = surfaces.get_mut(win.label()) {
                if state.pending && state.token == token {
                    // Closing/minimizing during a slow paint cancels this reveal.
                    // A delayed recovery must never take focus back afterward.
                    if !win.is_visible().unwrap_or(false)||win.is_minimized().unwrap_or(false){
                        state.pending=false;
                        set_cloaked(&win,false);
                        return;
                    }
                    state.applied = false;
                    state.pending = false;
                    state.prepared = false;
                    let _ = apply(&win, false, state.dark);
                    let _ = win.set_background_color(Some(opaque(state.dark)));
                    let _ = win.eval("document.documentElement.dataset.glass='false'");
                    set_cloaked(&win, false);
                    let _ = win.set_focus();
                    log::warn!(
                        "Presentation paint timed out: {} token {} (solid fallback)",
                        win.label(),
                        token
                    );
                }
            }
        });
    });
}
/// Finish native surface mutations under the cloak, BEFORE the renderer's
/// acknowledged frame. DwmFlush alone cannot repaint a WebView2 surface.
#[tauri::command]
pub fn window_material_prepare(window: WebviewWindow) -> Option<(u64, bool)> {
    if !persistent(window.label()) {
        return None;
    }
    let mut surfaces = SURFACES.lock().unwrap();
    let state = surfaces.get_mut(window.label())?;
    if !state.pending
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return None;
    }
    if !state.prepared {
        state.applied = apply(&window, state.applied && !window_power_saver(), state.dark);
        let color = if state.applied {
            tauri::window::Color(0, 0, 0, 0)
        } else {
            opaque(state.dark)
        };
        let _ = window.set_background_color(Some(color));
        // Activate the non-client state while still cloaked. Windows otherwise
        // shows the backdrop's inactive fallback until focus lands after the
        // uncloak, then fades it to live acrylic in front of the user.
        activate_backdrop(&window);
        state.prepared = true;
    }
    Some((state.token, state.applied))
}
#[tauri::command]
pub fn window_material_presented(window: WebviewWindow, token: u64) -> bool {
    let mut surfaces = SURFACES.lock().unwrap();
    let Some(state) = surfaces.get_mut(window.label()) else {
        return false;
    };
    if !state.pending
        || !state.prepared
        || state.token != token
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return false;
    }
    // No material/background mutation after the paint acknowledgement.
    #[cfg(windows)]
    unsafe {
        let _ = windows::Win32::Graphics::Dwm::DwmFlush();
    }
    if !set_cloaked(&window, false) {
        return false;
    }
    state.pending = false;
    drop(surfaces);
    let _ = window.set_focus();
    if window.label() == "editor" {
        if let Some(main) = window.app_handle().get_webview_window("main") {
            if main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false) {
                let _ = main.minimize();
            }
        }
    }
    log::debug!("Presentation painted: {} token {}", window.label(), token);
    if window.label()=="main"{crate::window::prewarm_editors_after_present(window.app_handle());}
    true
}

/// Close a reused persistent window without leaving its last frame in the
/// retained surface: cloak now (it vanishes instantly), let the page clear and
/// paint an empty frame, then hide on `window_retire_done` — or after a short
/// fallback if the page never answers. A hidden WebView2 never repaints, so
/// clearing after the hide would leave the old image for the next open.
pub fn retire(window: &WebviewWindow, event: &str) {
    if !set_cloaked(window, true) {
        let _ = window.hide();
        let _ = window.emit_to(window.label(), event, ());
        return;
    }
    let serial = RETIRE_SERIAL.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    RETIRING.lock().unwrap().insert(window.label().to_string(), serial);
    let _ = window.emit_to(window.label(), event, ());
    let win = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        let app = win.app_handle().clone();
        let _ = app.run_on_main_thread(move || finish_retire(&win, Some(serial)));
    });
}
static RETIRE_SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static RETIRING: LazyLock<Mutex<HashMap<String, u64>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn finish_retire(window: &WebviewWindow, serial: Option<u64>) {
    let mut retiring = RETIRING.lock().unwrap();
    match (retiring.get(window.label()), serial) {
        (None, _) => return,
        (Some(current), Some(expected)) if *current != expected => return,
        _ => {}
    }
    retiring.remove(window.label());
    drop(retiring);
    let _ = window.hide();
    set_cloaked(window, false);
}
/// The page has painted its cleared frame; hide the (still cloaked) window.
#[tauri::command]
pub fn window_retire_done(window: WebviewWindow) {
    finish_retire(&window, None);
}

#[cfg(windows)]
fn activate_backdrop(window: &WebviewWindow) {
    use windows::Win32::{Foundation::{LPARAM, WPARAM}, UI::WindowsAndMessaging::SendMessageW};
    if let Ok(hwnd) = window.hwnd() {
        let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
        unsafe {
            let _ = SendMessageW(hwnd, 0x0086, Some(WPARAM(1)), Some(LPARAM(0))); // WM_NCACTIVATE
        }
    }
}
#[cfg(not(windows))]
fn activate_backdrop(_: &WebviewWindow) {}

#[cfg(windows)]
fn set_cloaked(window: &WebviewWindow, cloaked: bool) -> bool {
    use windows::Win32::Graphics::Dwm::{
        DwmGetWindowAttribute, DwmSetWindowAttribute, DWMWA_CLOAK, DWMWA_CLOAKED,
    };
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
    let value = i32::from(cloaked);
    unsafe {
        if DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, (&value as *const i32).cast(), 4).is_err() {
            return false;
        }
        let mut physical = 0u32;
        DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&mut physical as *mut u32).cast(), 4).is_ok()
            && ((physical & 1 != 0) == cloaked)
    }
}
#[cfg(not(windows))]
fn set_cloaked(_: &WebviewWindow, _: bool) -> bool {
    false
}

#[cfg(windows)]
fn apply(window: &WebviewWindow, glass: bool, dark: bool) -> bool {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::{
        Foundation::HWND,
        Graphics::Dwm::{DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWINDOWATTRIBUTE},
        UI::Controls::MARGINS,
    };
    let Ok(handle) = window.window_handle() else {
        return false;
    };
    let RawWindowHandle::Win32(raw) = handle.as_raw() else {
        return false;
    };
    let hwnd = HWND(raw.hwnd.get() as *mut core::ffi::c_void);
    // Windows respects the system transparency preference.
    let allowed = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        .and_then(|key| key.get_value::<u32, _>("EnableTransparency"))
        .unwrap_or(1)
        != 0;
    let enabled = glass && allowed;
    let set = |attribute, value: u32| unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWINDOWATTRIBUTE(attribute),
            (&value as *const u32).cast(),
            4,
        )
    };
    let _ = set(20, dark as u32); // immersive dark appearance
    let _ = set(33, 2); // DWMWCP_ROUND, compositor corners (no GDI clipping)
                        // Windows 11 system acrylic reflects live content behind the window.
                        // This is the same DWMSBT_TRANSIENTWINDOW material used by Seek.
    let accepted = set(38, if enabled { 3 } else { 1 }).is_ok() && enabled;
    let inset = if accepted { -1 } else { 1 };
    let margins = MARGINS {
        cxLeftWidth: inset,
        cxRightWidth: inset,
        cyTopHeight: inset,
        cyBottomHeight: inset,
    };
    let extended = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) }.is_ok();
    if accepted && !extended {
        let _ = set(38, 1);
    }
    accepted && extended
}

#[cfg(not(windows))]
fn apply(_: &WebviewWindow, _: bool, _: bool) -> bool {
    false
}

#[tauri::command]
pub fn window_power_saver() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut status = SYSTEM_POWER_STATUS::default();
        return unsafe { GetSystemPowerStatus(&mut status) }.is_ok()
            && status.SystemStatusFlag == 1;
    }
    #[cfg(not(windows))]
    {
        false
    }
}
