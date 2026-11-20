//! Explicit, user-started wheel steps directed only at the selected window.
//!
//! Steps are first posted straight to the window (no pointer movement). Some
//! browsers ignore posted wheels — Firefox-based ones route by the real cursor,
//! others put an overlay above the page — so after a step that does not move the
//! page, the session switches to genuine wheel input at the selected point,
//! returning the pointer to where it was after each step.
use windows::Win32::{
    Foundation::{HWND, LPARAM, POINT, WPARAM},
    UI::WindowsAndMessaging::{
        GetAncestor, GetWindowThreadProcessId, IsWindow, PostMessageW, WindowFromPoint, GA_ROOT,
        WM_MOUSEWHEEL,
    },
};
pub struct Target {
    root: HWND,
    point: POINT,
    real_input: std::cell::Cell<bool>,
}
fn wheel_params(x: i32, y: i32) -> (WPARAM, LPARAM) {
    (
        WPARAM(((-120i16) as u16 as usize) << 16),
        LPARAM(((x as u16 as u32) | ((y as u16 as u32) << 16)) as isize),
    )
}
impl Target {
    pub fn at(x: i32, y: i32) -> Result<Self, String> {
        let point = POINT { x, y };
        let child = unsafe { WindowFromPoint(point) };
        if child.0.is_null() {
            return Err("Select a region inside the page you want to scroll".into());
        }
        let root = unsafe { GetAncestor(child, GA_ROOT) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(root, Some(&mut pid));
        }
        if pid == std::process::id() {
            return Err("Move the capture controller outside the selected region".into());
        }
        Ok(Self { root, point, real_input: std::cell::Cell::new(false) })
    }
    /// Switch this session to genuine wheel input. True only the first time.
    pub fn use_real_input(&self) -> bool {
        !self.real_input.replace(true)
    }
    pub fn down(&self) -> Result<(), String> {
        unsafe {
            if !IsWindow(Some(self.root)).as_bool() {
                return Err("The selected window closed. Finish or cancel this capture.".into());
            }
            let child = WindowFromPoint(self.point);
            if GetAncestor(child, GA_ROOT) != self.root {
                return Err("The selected page is covered. Bring it back into view, then resume auto-scroll.".into());
            }
            if self.real_input.get() {
                return real_wheel(self.point);
            }
            let (w, l) = wheel_params(self.point.x, self.point.y);
            PostMessageW(Some(child),WM_MOUSEWHEEL,w,l).map_err(|_|"This window blocked automatic scrolling. Scroll manually, or run both apps at the same permission level.".to_string())
        }
    }
}
/// One genuine wheel notch at `point`; the pointer returns to where it was.
fn real_wheel(point: POINT) -> Result<(), String> {
    use windows::Win32::UI::{
        Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT},
        WindowsAndMessaging::{GetCursorPos, SetCursorPos},
    };
    let blocked = || "This window blocked automatic scrolling. Scroll manually, or run both apps at the same permission level.".to_string();
    unsafe {
        let mut previous = POINT::default();
        let _ = GetCursorPos(&mut previous);
        SetCursorPos(point.x, point.y).map_err(|_| blocked())?;
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT { mouseData: (-120i32) as u32, dwFlags: MOUSEEVENTF_WHEEL, ..Default::default() },
            },
        };
        let sent = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        // Let the input thread route the notch under the selected point first.
        std::thread::sleep(std::time::Duration::from_millis(30));
        let _ = SetCursorPos(previous.x, previous.y);
        if sent == 1 { Ok(()) } else { Err(blocked()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wheel_keeps_negative_monitor_coordinates_and_scrolls_down() {
        let (w, l) = wheel_params(-1500, -300);
        assert_eq!(((w.0 >> 16) as u16) as i16, -120);
        assert_eq!((l.0 as u16) as i16, -1500);
        assert_eq!(((l.0 >> 16) as u16) as i16, -300);
    }
}
