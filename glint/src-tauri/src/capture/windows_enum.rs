//! Top-level window enumeration (Window capture mode) + pure hit-test.
//!
//! `Window::all()` in xcap 0.9.6 uses `EnumWindows` internally, which
//! enumerates top-level windows from topmost to bottom-most Z order.
//! The returned `Vec<WindowInfo>` therefore preserves topmost-first ordering
//! without any additional sorting.

#[derive(Clone, Debug)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// `windows` must be ordered topmost-first. Returns the first window containing the point.
pub fn window_at(windows: &[WindowInfo], x: i32, y: i32) -> Option<&WindowInfo> {
    windows.iter().find(|win| {
        x >= win.x
            && y >= win.y
            && x < win.x + win.w as i32
            && y < win.y + win.h as i32
    })
}

/// Enumerate top-level windows, topmost first. Returns empty on backend failure (caller
/// falls back to Area behaviour) — never panics.
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
            Some(WindowInfo {
                id: win.id().ok()?,
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
    #[ignore]
    fn list_windows_does_not_panic() {
        // Integration test — requires a real Windows desktop.
        // Run with: cargo test -- --ignored
        let wins = list_windows();
        println!("Enumerated {} windows", wins.len());
        for w in &wins {
            println!("  [{:08x}] {:?} / {:?}  @ ({},{}) {}x{}", w.id, w.app, w.title, w.x, w.y, w.w, w.h);
        }
    }
}
