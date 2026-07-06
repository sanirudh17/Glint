//! Top-level window enumeration (Window capture mode) + pure hit-test.
//!
//! `Window::all()` in xcap 0.9.6 uses `EnumWindows` internally, which
//! enumerates top-level windows from topmost to bottom-most Z order.
//! The returned `Vec<WindowInfo>` therefore preserves topmost-first ordering
//! without any additional sorting.

#[derive(Clone, Debug)]
pub struct WindowInfo {
    pub id: u32,
    // `title`/`app` are captured now to feed P4 Library metadata; not yet read
    // by the P2 crop path (the overlay only needs geometry).
    #[allow(dead_code)]
    pub title: String,
    #[allow(dead_code)]
    pub app: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// `windows` must be ordered topmost-first. Returns the first window containing the point.
///
/// Window-mode hit-testing happens client-side in the overlay (`modes.ts`
/// `windowAt`); this Rust twin is unit-tested and kept as the canonical
/// reference / for any future server-side hit-test. Not on the P2 hot path.
#[allow(dead_code)]
pub fn window_at(windows: &[WindowInfo], x: i32, y: i32) -> Option<&WindowInfo> {
    windows.iter().find(|win| {
        x >= win.x
            && y >= win.y
            && x < win.x + win.w as i32
            && y < win.y + win.h as i32
    })
}

/// Win32 class names of the Windows shell surfaces we never want as Window-capture
/// targets: the taskbar(s) and the desktop/wallpaper host. We filter by CLASS (not by
/// title / app_name) so that real Explorer file windows — which also belong to
/// explorer.exe — stay selectable.
const SHELL_CLASSES: &[&str] = &[
    "Shell_TrayWnd",          // primary taskbar
    "Shell_SecondaryTrayWnd", // per-monitor secondary taskbars
    "Progman",                // desktop (Program Manager)
    "WorkerW",                // desktop wallpaper host
];

/// True for a shell surface (taskbar / desktop) that must never be offered as a Window
/// capture target. Pure + exact-match (Win32 class names are case-sensitive).
pub fn is_shell_class(class: &str) -> bool {
    SHELL_CLASSES.contains(&class)
}

/// Look up a top-level window's Win32 class name from its HWND (xcap's `id` IS the HWND on
/// Windows). Returns None on failure — the caller then treats the window as capturable.
#[cfg(windows)]
fn window_class_name(id: u32) -> Option<String> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let hwnd = HWND(id as usize as *mut core::ffi::c_void);
    let mut buf = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) };
    if len <= 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..len as usize]))
}

/// Whether a window should appear as a Window-capture target — false for the taskbar and
/// desktop shell. On non-Windows builds everything is capturable (no class to inspect).
fn is_capturable(id: u32) -> bool {
    #[cfg(windows)]
    {
        window_class_name(id).map(|c| !is_shell_class(&c)).unwrap_or(true)
    }
    #[cfg(not(windows))]
    {
        let _ = id;
        true
    }
}

/// Enumerate top-level windows, topmost first. Skips minimized windows and the shell
/// surfaces (taskbar / desktop) so Window mode offers only real application windows.
/// Returns empty on backend failure (caller falls back to Area behaviour) — never panics.
pub fn list_windows() -> Vec<WindowInfo> {
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => {
            log::warn!("window enumeration failed: {e}");
            return Vec::new();
        }
    };
    windows
        .into_iter()
        .filter(|win| !win.is_minimized().unwrap_or(true))
        .filter_map(|win| {
            let id = win.id().ok()?;
            if !is_capturable(id) {
                return None; // taskbar / desktop shell — not a real capture target
            }
            Some(WindowInfo {
                id,
                title: win.title().unwrap_or_default(),
                app: win.app_name().unwrap_or_default(),
                x: win.x().ok()?,
                y: win.y().ok()?,
                w: win.width().ok()?,
                h: win.height().ok()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(id: u32, x: i32, y: i32, ww: u32, h: u32) -> WindowInfo {
        WindowInfo {
            id,
            title: String::new(),
            app: String::new(),
            x,
            y,
            w: ww,
            h,
        }
    }

    #[test]
    fn topmost_window_wins_overlap() {
        let list = vec![w(1, 0, 0, 100, 100), w(2, 10, 10, 50, 50)];
        // list is topmost-first; point in both → id 1 (front)
        assert_eq!(window_at(&list, 20, 20).map(|x| x.id), Some(1));
    }

    #[test]
    fn point_outside_all_is_none() {
        let list = vec![w(1, 0, 0, 10, 10)];
        assert_eq!(window_at(&list, 999, 999).map(|x| x.id), None);
    }

    #[test]
    fn shell_surfaces_are_filtered_but_app_windows_are_not() {
        // Taskbar + desktop shell → excluded.
        assert!(is_shell_class("Shell_TrayWnd"));
        assert!(is_shell_class("Shell_SecondaryTrayWnd"));
        assert!(is_shell_class("Progman"));
        assert!(is_shell_class("WorkerW"));
        // Real application window classes (incl. Explorer file windows) → kept.
        assert!(!is_shell_class("CabinetWClass")); // Explorer folder window
        assert!(!is_shell_class("Chrome_WidgetWin_1"));
        assert!(!is_shell_class("")); // unknown/empty is not a shell surface
    }

    #[test]
    #[ignore = "requires a real Windows desktop; run manually with --ignored"]
    fn list_windows_does_not_panic() {
        let wins = list_windows();
        println!("Enumerated {} windows", wins.len());
        for w in &wins {
            println!("  [{:08x}] {:?} / {:?}  @ ({},{}) {}x{}", w.id, w.app, w.title, w.x, w.y, w.w, w.h);
        }
    }
}
