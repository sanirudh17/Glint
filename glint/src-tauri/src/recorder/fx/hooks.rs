//! Global low-level mouse + keyboard hooks feeding the rec-fx overlay. The hooks
//! run on a dedicated thread with a Win32 message pump (LL hooks require a message
//! loop on the installing thread). Callbacks stay non-blocking: they emit a small
//! Tauri event to the overlay and return immediately. Keylogger-shaped but LOCAL —
//! events only drive on-screen chips, never persisted or sent.

use std::cell::Cell;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, PostThreadMessageW, SetWindowsHookExW,
    TranslateMessage, UnhookWindowsHookEx, KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT,
    WH_KEYBOARD_LL, WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_MOUSEMOVE,
    WM_QUIT, WM_RBUTTONDOWN, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

/// Pure throttle predicate — true if enough time elapsed to emit again.
pub fn throttle_ok(last_ms: u64, now_ms: u64, min_gap_ms: u64) -> bool {
    now_ms.saturating_sub(last_ms) >= min_gap_ms
}

// Per-hook-thread context. LL hook callbacks are plain C fns with no user param, so
// the AppHandle + config + throttle clock live in thread-locals set at thread start.
thread_local! {
    static APP: Cell<Option<AppHandle>> = const { Cell::new(None) };
    static CFG: Cell<super::FxConfig> = const { Cell::new(super::FxConfig {
        click_viz: false, keystrokes: false, spotlight: false, cursor_hide: false, cursor_size: 0,
    }) };
    static LAST_MOVE: Cell<u64> = const { Cell::new(0) };
}

const MOVE_GAP_MS: u64 = 16; // ~60 Hz cursor emits

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit(event: &str, payload: serde_json::Value) {
    APP.with(|a| {
        // take/replace so we borrow the AppHandle without moving the Cell's contents away.
        if let Some(app) = a.take() {
            let _ = app.emit_to(super::window::FX_LABEL, event, payload);
            a.set(Some(app));
        }
    });
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let (x, y) = (info.pt.x, info.pt.y);
        match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                if CFG.with(|c| c.get().click_viz) {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "left" }));
                }
            }
            WM_RBUTTONDOWN => {
                if CFG.with(|c| c.get().click_viz) {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "right" }));
                }
            }
            WM_MOUSEMOVE => {
                let cfg = CFG.with(|c| c.get());
                if cfg.spotlight || cfg.cursor_hide || cfg.cursor_size > 0 {
                    let now = now_ms();
                    let last = LAST_MOVE.with(|l| l.get());
                    if throttle_ok(last, now, MOVE_GAP_MS) {
                        LAST_MOVE.with(|l| l.set(now));
                        emit("fx-cursor", serde_json::json!({ "x": x, "y": y }));
                    }
                }
            }
            _ => {}
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 && CFG.with(|c| c.get().keystrokes) {
        let info = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let msg = wparam.0 as u32;
        let down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if down || up {
            if let Some((label, is_mod)) = super::keymap::vk_label(info.vkCode) {
                emit("fx-key", serde_json::json!({ "text": label, "isModifier": is_mod, "down": down }));
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

pub struct HookHandle {
    thread_id: u32,
    join: Option<std::thread::JoinHandle<()>>,
}

impl HookHandle {
    /// Signal the pump thread to quit and join it (unhooks on the way out).
    pub fn stop(mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

/// Install the hooks on a fresh thread and run its message pump. Returns a handle
/// whose `stop()` cleanly unhooks + joins.
pub fn start_hooks(app: AppHandle, cfg: super::FxConfig) -> HookHandle {
    let (tx, rx) = std::sync::mpsc::channel::<u32>();
    let join = std::thread::spawn(move || {
        APP.with(|a| a.set(Some(app)));
        CFG.with(|c| c.set(cfg));
        // Publish our thread id so the caller can PostThreadMessage(WM_QUIT).
        let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
        let _ = tx.send(tid);

        // Only hook what's needed. In particular the KEYBOARD hook is installed
        // solely when keystroke display is on — we never watch the keyboard for the
        // mouse-only effects (privacy).
        let want_mouse = cfg.click_viz || cfg.spotlight || cfg.cursor_hide || cfg.cursor_size > 0;
        let want_kbd = cfg.keystrokes;
        let mouse = if want_mouse {
            unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), None, 0) }.ok()
        } else {
            None
        };
        let keyboard = if want_kbd {
            unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), None, 0) }.ok()
        } else {
            None
        };
        if want_mouse && mouse.is_none() {
            log::warn!("fx: mouse hook failed to install");
        }
        if want_kbd && keyboard.is_none() {
            log::warn!("fx: keyboard hook failed to install");
        }

        // Standard LL-hook message pump. GetMessageW returns 0 on WM_QUIT → exit.
        unsafe {
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if let Some(h) = mouse {
                let _ = UnhookWindowsHookEx(h);
            }
            if let Some(h) = keyboard {
                let _ = UnhookWindowsHookEx(h);
            }
        }
        APP.with(|a| {
            a.take();
        });
    });
    let thread_id = rx.recv().unwrap_or(0);
    HookHandle { thread_id, join: Some(join) }
}

#[cfg(test)]
mod tests {
    use super::throttle_ok;

    #[test]
    fn throttle_allows_after_gap() {
        assert!(throttle_ok(0, 20, 16)); // 20ms since last ≥ 16ms gap
        assert!(!throttle_ok(0, 10, 16)); // only 10ms elapsed
        assert!(throttle_ok(100, 116, 16));
    }
}
