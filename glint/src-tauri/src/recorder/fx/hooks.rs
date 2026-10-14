//! Global low-level mouse + keyboard hooks feeding the rec-fx overlay. The hooks
//! run on a dedicated thread with a Win32 message pump (LL hooks require a message
//! loop on the installing thread). Callbacks stay non-blocking: they emit a small
//! Tauri event to the overlay and return immediately. Keylogger-shaped but LOCAL —
//! Quick events only drive on-screen chips. Studio events persist locally in
//! the editable sidecar; neither mode sends input events over the network.

use std::cell::{Cell, RefCell};
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
    static STUDIO: RefCell<Option<crate::recorder::studio::EventSink>> = const { RefCell::new(None) };
    static LAST_MOVE: Cell<u64> = const { Cell::new(0) };
    static MARKER_HELD: Cell<bool> = const { Cell::new(false) };
}

// Emit once per press; consume repeats and release so the target app does not
// receive Studio's marker shortcut. Quick-mode input never enters this path.
pub fn marker_action(vk:u32,down:bool,modifiers:&[&str],held:&mut bool)->(bool,bool) {
    if vk!=0x5A {return (false,false);}
    if !down {let consumed=*held;*held=false;return (false,consumed);}
    if *held {return (false,true);}
    if modifiers.contains(&"Ctrl")&&modifiers.contains(&"Alt") {
        *held=true;return (true,true);
    } (false,false)
}

const MOVE_GAP_MS: u64 = 16; // ~60 Hz cursor emits

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit(event: &str, mut payload: serde_json::Value) {
    let persisted=STUDIO.with(|s| {
        if let Some(sink)=s.borrow().as_ref() {
            payload["kind"]=serde_json::json!(match event { "fx-cursor" => "cursor", "fx-click" => "click", "fx-marker"=>"marker", _ => "key" });
            sink.push(payload.clone()); true
        } else {false}
    });
    if persisted {return;}

    APP.with(|a| {
        // take/replace so we borrow the AppHandle without moving the Cell's contents away.
        if let Some(app) = a.take() {
            let _ = app.emit_to(super::window::FX_LABEL, event, payload);
            a.set(Some(app));
        }
    });
}

fn current_modifiers(current_vk: u32, is_down: bool) -> Vec<&'static str> {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_LCONTROL, VK_LMENU, VK_LWIN, VK_MENU, VK_RCONTROL,
            VK_RMENU, VK_RWIN, VK_SHIFT,
        };
        let mut mods = Vec::with_capacity(4);

        let ctrl_down = match current_vk {
            0x11 | 0xA2 | 0xA3 => is_down,
            _ => {
                let s = GetAsyncKeyState(VK_CONTROL.0 as i32) as u16;
                let sl = GetAsyncKeyState(VK_LCONTROL.0 as i32) as u16;
                let sr = GetAsyncKeyState(VK_RCONTROL.0 as i32) as u16;
                ((s | sl | sr) & 0x8000) != 0
            }
        };
        if ctrl_down {
            mods.push("Ctrl");
        }

        let alt_down = match current_vk {
            0x12 | 0xA4 | 0xA5 => is_down,
            _ => {
                let s = GetAsyncKeyState(VK_MENU.0 as i32) as u16;
                let sl = GetAsyncKeyState(VK_LMENU.0 as i32) as u16;
                let sr = GetAsyncKeyState(VK_RMENU.0 as i32) as u16;
                ((s | sl | sr) & 0x8000) != 0
            }
        };
        if alt_down {
            mods.push("Alt");
        }

        let shift_down = match current_vk {
            0x10 | 0xA0 | 0xA1 => is_down,
            _ => {
                let s = GetAsyncKeyState(VK_SHIFT.0 as i32) as u16;
                let sl = GetAsyncKeyState(0xA0) as u16; // VK_LSHIFT
                let sr = GetAsyncKeyState(0xA1) as u16; // VK_RSHIFT
                ((s | sl | sr) & 0x8000) != 0
            }
        };
        if shift_down {
            mods.push("Shift");
        }

        let win_down = match current_vk {
            0x5B | 0x5C => is_down,
            _ => {
                let sl = GetAsyncKeyState(VK_LWIN.0 as i32) as u16;
                let sr = GetAsyncKeyState(VK_RWIN.0 as i32) as u16;
                ((sl | sr) & 0x8000) != 0
            }
        };
        if win_down {
            mods.push("Win");
        }

        mods
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let info = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let (x, y) = (info.pt.x, info.pt.y);
        let cfg = CFG.with(|c| c.get());
        match wparam.0 as u32 {
            WM_LBUTTONDOWN => {
                if cfg.click_viz {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "left" }));
                }
                if cfg.keystrokes {
                    let mods = current_modifiers(0, false);
                    if !mods.is_empty() {
                        emit("fx-key", serde_json::json!({
                            "text": "Click",
                            "isModifier": false,
                            "down": true,
                            "modifiers": mods,
                        }));
                    }
                }
            }
            WM_RBUTTONDOWN => {
                if cfg.click_viz {
                    emit("fx-click", serde_json::json!({ "x": x, "y": y, "button": "right" }));
                }
                if cfg.keystrokes {
                    let mods = current_modifiers(0, false);
                    if !mods.is_empty() {
                        emit("fx-key", serde_json::json!({
                            "text": "Right Click",
                            "isModifier": false,
                            "down": true,
                            "modifiers": mods,
                        }));
                    }
                }
            }
            WM_MOUSEMOVE => {
                if cfg.spotlight || cfg.cursor_hide || cfg.cursor_size > 0 {
                    let now = now_ms();
                    let last = LAST_MOVE.with(|l| l.get());
                    if throttle_ok(last, now, if STUDIO.with(|s|s.borrow().is_some()) {8} else {MOVE_GAP_MS}) {
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
            let mods=current_modifiers(info.vkCode,down);
            if STUDIO.with(|sink|sink.borrow().is_some()) {
                let (mark,consume)=MARKER_HELD.with(|held|{let mut value=held.get();let result=marker_action(info.vkCode,down,&mods,&mut value);held.set(value);result});
                if mark {
                    let mut point=windows::Win32::Foundation::POINT::default();
                    if windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point).is_ok() {
                        emit("fx-marker",serde_json::json!({"x":point.x,"y":point.y}));
                    }
                }
                if consume {return LRESULT(1);}
            }
            if let Some((label, is_mod)) = super::keymap::vk_label(info.vkCode) {
                emit("fx-key", serde_json::json!({
                    "text": label,
                    "isModifier": is_mod,
                    "down": down,
                    "modifiers": mods,
                }));
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
    pub fn stop(mut self) {self.shutdown();}
    fn shutdown(&mut self) {
        unsafe {
            let _ = PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

impl Drop for HookHandle { fn drop(&mut self) {if self.join.is_some() {self.shutdown();}} }

/// Install the hooks on a fresh thread and run its message pump. Returns a handle
/// whose `stop()` cleanly unhooks + joins.
pub fn start_hooks(app: AppHandle, cfg: super::FxConfig) -> HookHandle {
    install_hooks(app, cfg, None).expect("Quick hook thread failed")
}

pub fn start_studio_hooks(app: AppHandle, sink: crate::recorder::studio::EventSink) -> Result<HookHandle,String> {
    install_hooks(app, super::FxConfig {click_viz:true,keystrokes:true,spotlight:true,cursor_hide:false,cursor_size:0}, Some(sink))
}
fn install_hooks(app: AppHandle, cfg: super::FxConfig, sink: Option<crate::recorder::studio::EventSink>) -> Result<HookHandle,String> {
    let (tx, rx) = std::sync::mpsc::channel::<u32>();
    let join = std::thread::spawn(move || {
        APP.with(|a| a.set(Some(app)));
        CFG.with(|c| c.set(cfg));
        let studio = sink.is_some();
        STUDIO.with(|s| *s.borrow_mut()=sink);
        // Publish our thread id so the caller can PostThreadMessage(WM_QUIT).
        let tid = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };


        // Only hook what's needed. In particular the KEYBOARD hook is installed
        // solely when keystroke display is on — we never watch the keyboard for the
        // mouse-only effects (privacy).
        let want_mouse = cfg.click_viz || cfg.spotlight || cfg.cursor_hide || cfg.cursor_size > 0 || cfg.keystrokes;
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

        // Create the message queue before publishing the thread id (stop can race startup).
        unsafe { let mut msg=MSG::default(); let _=windows::Win32::UI::WindowsAndMessaging::PeekMessageW(&mut msg,None,0,0,windows::Win32::UI::WindowsAndMessaging::PM_NOREMOVE); }
        if studio && (mouse.is_none() || keyboard.is_none()) {
            unsafe { if let Some(h)=mouse {let _=UnhookWindowsHookEx(h);} if let Some(h)=keyboard {let _=UnhookWindowsHookEx(h);} }
            STUDIO.with(|s| *s.borrow_mut()=None); return;
        }
        let _=tx.send(tid);
        let timer=if studio {unsafe {windows::Win32::UI::WindowsAndMessaging::SetTimer(None,0,8,None)}} else {0};
        // Standard LL-hook message pump. GetMessageW returns 0 on WM_QUIT → exit.
        unsafe {
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                if studio && msg.message == windows::Win32::UI::WindowsAndMessaging::WM_TIMER {
                    let mut point=windows::Win32::Foundation::POINT::default();
                    if windows::Win32::UI::WindowsAndMessaging::GetCursorPos(&mut point).is_ok() {
                        emit("fx-cursor",serde_json::json!({"x":point.x,"y":point.y}));
                    }
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            if timer != 0 {let _=windows::Win32::UI::WindowsAndMessaging::KillTimer(None,timer);}
            if let Some(h) = mouse {
                let _ = UnhookWindowsHookEx(h);
            }
            if let Some(h) = keyboard {
                let _ = UnhookWindowsHookEx(h);
            }
        }
        STUDIO.with(|s| *s.borrow_mut()=None);
        APP.with(|a| {
            a.take();
        });
    });
    let thread_id = rx.recv().map_err(|_|"Couldn't install Studio input hooks".to_string())?;
    Ok(HookHandle { thread_id, join: Some(join) })
}

#[cfg(test)]
mod tests {
    use super::{throttle_ok,marker_action};

    #[test]
    fn marker_chord_ignores_repeats_and_releases_the_capture() {
        let mut held=false;
        assert_eq!(marker_action(0x5A,true,&["Ctrl"],&mut held),(false,false));
        assert_eq!(marker_action(0x5A,true,&["Ctrl","Alt"],&mut held),(true,true));
        assert_eq!(marker_action(0x5A,true,&["Ctrl","Alt"],&mut held),(false,true));
        assert_eq!(marker_action(0x5A,false,&[],&mut held),(false,true));
        assert!(!held);
    }

    #[test]
    fn throttle_allows_after_gap() {
        assert!(throttle_ok(0, 20, 16)); // 20ms since last ≥ 16ms gap
        assert!(!throttle_ok(0, 10, 16)); // only 10ms elapsed
        assert!(throttle_ok(100, 116, 16));
    }
}
