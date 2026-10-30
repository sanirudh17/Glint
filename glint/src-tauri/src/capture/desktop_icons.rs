//! Briefly hide only the desktop icon view, restoring its exact prior visibility.
use std::sync::Mutex;
use windows::{
    core::{w, BOOL},
    Win32::{
        Foundation::{HWND, LPARAM},
        Graphics::Dwm::DwmFlush,
        UI::WindowsAndMessaging::{
            EnumWindows, FindWindowExW, IsWindow, IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNA,
        },
    },
};
static ICON_CAPTURE: Mutex<()> = Mutex::new(());
unsafe extern "system" fn find_view(parent: HWND, data: LPARAM) -> BOOL {
    if let Ok(view) = FindWindowExW(Some(parent), None, w!("SHELLDLL_DefView"), None) {
        if let Ok(icons) = FindWindowExW(Some(view), None, w!("SysListView32"), None) {
            *(data.0 as *mut Option<HWND>) = Some(icons);
            return BOOL(0);
        }
    }
    BOOL(1)
}
fn icon_view() -> Option<HWND> {
    let mut found = None;
    unsafe {
        let _ = EnumWindows(Some(find_view), LPARAM(&mut found as *mut _ as isize));
    }
    found
}
struct Restore(Option<HWND>);
impl Drop for Restore {
    fn drop(&mut self) {
        if let Some(hwnd) = self.0 {
            unsafe {
                if IsWindow(Some(hwnd)).as_bool() {
                    let _ = ShowWindow(hwnd, SW_SHOWNA);
                    let _ = DwmFlush();
                }
            }
        }
    }
}

pub fn during<T>(enabled: bool, capture: impl FnOnce() -> T) -> T {
    let _guard = guard(enabled);
    capture()
}

pub fn guard(enabled: bool) -> impl Drop {
    // Fields drop in declaration order: restore visibility before unlocking.
    struct Guard {
        _restore: Restore,
        _lock: Option<std::sync::MutexGuard<'static, ()>>,
    }
    impl Drop for Guard {
        fn drop(&mut self) {}
    }
    let lock = enabled.then(|| ICON_CAPTURE.lock().unwrap_or_else(|e| e.into_inner()));
    let hidden = if enabled {
        icon_view().filter(|h| unsafe { IsWindowVisible(*h).as_bool() })
    } else {
        None
    };
    let restore = Restore(hidden);
    if let Some(hwnd) = hidden {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
            let _ = DwmFlush();
        }
    }
    Guard {
        _restore: restore,
        _lock: lock,
    }
}
