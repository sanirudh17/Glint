//! "Pin to Screen": floating, always-on-top windows showing a captured image.
//!
//! One borderless `WebviewWindow` per pin (label `pin-<n>`), backed by this
//! in-memory registry mapping label → PNG bytes + dims. Mirrors the HUD/overlay
//! pattern (Rust state + a `*_data` command the webview fetches on mount). Pins
//! are EPHEMERAL — closing a pin or quitting Glint clears its bytes; nothing is
//! persisted. No recorder coupling.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// One pinned image's bytes + intrinsic size.
#[derive(Clone)]
pub struct PinData {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Session registry of live pins, keyed by window label, plus a label counter.
#[derive(Default)]
pub struct PinState {
    pub pins: Mutex<HashMap<String, PinData>>,
    pub counter: AtomicU64,
}

impl PinState {
    /// A fresh unique window label `pin-<n>`.
    pub fn next_label(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("pin-{n}")
    }

    pub fn insert(&self, label: String, data: PinData) {
        self.pins.lock().unwrap().insert(label, data);
    }

    pub fn get(&self, label: &str) -> Option<PinData> {
        self.pins.lock().unwrap().get(label).cloned()
    }

    pub fn remove(&self, label: &str) {
        self.pins.lock().unwrap().remove(label);
    }
}

/// Drop a pin's bytes when its window goes away (OS-driven close, etc.) so a
/// closed pin never leaks its image for the rest of the session.
pub fn forget(pins: &PinState, label: &str) {
    pins.remove(label);
}

/// Initial pin size in LOGICAL px: the image's natural size scaled DOWN to fit
/// within `cap_frac` of the monitor's logical size, aspect preserved. Never
/// upscales a small image. `mon_*` are logical px.
pub fn capped_size(nat_w: u32, nat_h: u32, mon_w: f64, mon_h: f64, cap_frac: f64) -> (f64, f64) {
    let nw = nat_w.max(1) as f64;
    let nh = nat_h.max(1) as f64;
    let scale = ((mon_w * cap_frac) / nw)
        .min((mon_h * cap_frac) / nh)
        .min(1.0);
    (nw * scale, nh * scale)
}

const PIN_CAP_FRAC: f64 = 0.4;
const CASCADE_STEP: f64 = 28.0; // logical px offset between successive pins

/// Build, position, size, and show one pin window. Size = the image capped to
/// `PIN_CAP_FRAC` of the primary monitor; position cascades by pin index so new
/// pins don't stack exactly. Interactive (focus(false) only avoids stealing
/// focus on creation; the window still receives pointer/wheel events).
fn build_pin_window(app: &AppHandle, label: &str, nat_w: u32, nat_h: u32) -> tauri::Result<()> {
    let url = WebviewUrl::App("index.html#/pin".into());
    let win = WebviewWindowBuilder::new(app, label, url)
        .title("Glint Pin")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let msize = monitor.size(); // physical px
        let mon_w = msize.width as f64 / scale;
        let mon_h = msize.height as f64 / scale;
        let (w, h) = capped_size(nat_w, nat_h, mon_w, mon_h, PIN_CAP_FRAC);
        let _ = win.set_size(tauri::LogicalSize::new(w, h));

        // Cascade from a base offset near the monitor's top-left.
        let pos = monitor.position(); // physical px
        let idx = label
            .strip_prefix("pin-")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let off = (idx % 8.0) * CASCADE_STEP * scale;
        let x = pos.x as f64 + 80.0 * scale + off;
        let y = pos.y as f64 + 80.0 * scale + off;
        let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    } else {
        log::warn!("pin: no primary monitor; using default window geometry");
    }

    win.show()?;
    Ok(())
}

/// Pin the most recent capture (HUD "Pin" button).
///
/// `(async)` is load-bearing: it forces this command OFF the main thread.
/// `build_pin_window` builds a `WebviewWindow`, and building a webview while the
/// command occupies the main (event-loop) thread DEADLOCKS the loop — the same
/// gotcha the capture overlay avoids by building from a spawned thread. Running
/// the command on a worker thread lets the now-free event loop service the build.
#[tauri::command(async)]
pub fn pin_create_from_last(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    pins: State<PinState>,
) -> Result<(), String> {
    let (png, width, height) = {
        let guard = last.0.lock().unwrap();
        let l = guard.as_ref().ok_or("no capture to pin")?;
        let img = crate::capture::frozen::CapturedImage {
            width: l.width,
            height: l.height,
            rgba: l.rgba.clone(),
        };
        let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
        (png, l.width, l.height)
    };
    pin_from_png_bytes(&app, &pins, png, width, height)
}

/// Insert a pin from PNG bytes and build its window. Shared by from-last,
/// from-Library, and tray-pin. `(async)` callers keep this off the main thread.
pub fn pin_from_png_bytes(
    app: &AppHandle,
    pins: &PinState,
    png: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let label = pins.next_label();
    pins.insert(label.clone(), PinData { png, width, height });
    build_pin_window(app, &label, width, height).map_err(|e| e.to_string())
}

/// Pin a saved Library capture by id.
///
/// `(async)` is load-bearing — see [`pin_create_from_last`]: it runs this command
/// off the main thread so `build_pin_window` can't deadlock the event loop.
#[tauri::command(async)]
pub fn pin_create_from_capture(
    app: AppHandle,
    db: State<crate::Db>,
    pins: State<PinState>,
    id: i64,
) -> Result<(), String> {
    let path = {
        let conn = db.0.lock().unwrap();
        crate::db::capture_path(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("capture not found")?
    };
    if !std::path::Path::new(&path).exists() {
        return Err("This capture's file is no longer on disk — it may have been moved or deleted.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (decoded.width(), decoded.height());
    pin_from_png_bytes(&app, &pins, bytes, width, height)
}

/// The image a pin webview loads on mount, keyed by the CALLING window's label.
#[derive(Serialize)]
pub struct PinDataDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn pin_data(pins: State<PinState>, window: WebviewWindow) -> Result<PinDataDto, String> {
    let d = pins.get(window.label()).ok_or("no pin data for this window")?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&d.png);
    Ok(PinDataDto {
        image_data_url: format!("data:image/png;base64,{b64}"),
        width: d.width,
        height: d.height,
    })
}

/// Save `label`'s pinned image as a NEW Library capture (never overwrites). Reuses
/// the same write+thumb+insert+emit path as `editor_save`/`hud_save`. Shared by the
/// `pin_save` command and the right-click menu.
pub fn save_pin(app: &AppHandle, label: &str) -> Result<String, String> {
    let pins = app.state::<PinState>();
    let d = pins.get(label).ok_or("no pin data for this window")?;
    let dir = crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Screenshot);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (image_format, jpeg_quality) = {
        let s = app.state::<crate::settings::commands::SettingsState>();
        let g = s.0.lock().unwrap();
        (g.image_format.clone(), g.jpeg_quality.clone())
    };
    // Decode the stored PNG once; re-encode into the chosen save format.
    let rgba = image::load_from_memory(&d.png).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let (save_bytes, ext) =
        crate::settings::image::encode_save(&rgba, w, h, &image_format, &jpeg_quality)?;
    let filename = crate::paths::capture_filename(chrono::Local::now(), ext);
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &save_bytes).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    let thumb_path = crate::capture::commands::write_thumb(app, &rgba.into_raw(), w, h, &dest_str);
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes: Some(save_bytes.len() as i64),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let db = app.state::<crate::Db>();
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("pin_save insert_capture failed: {e}");
        }
    }
    let _ = tauri::Emitter::emit(app, "capture-saved", ());
    Ok(dest_str)
}

/// Copy `label`'s pinned image to the clipboard. Shared by the command + menu.
pub fn copy_pin(app: &AppHandle, label: &str) -> Result<(), String> {
    let pins = app.state::<PinState>();
    let d = pins.get(label).ok_or("no pin data for this window")?;
    let rgba = image::load_from_memory(&d.png).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    crate::clipboard::copy_image(&rgba.into_raw(), w, h)
}

/// Close `label`'s pin: drop its bytes and close the window. Shared by cmd + menu.
pub fn close_pin(app: &AppHandle, label: &str) {
    app.state::<PinState>().remove(label);
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
}

#[tauri::command]
pub fn pin_save(app: AppHandle, window: WebviewWindow) -> Result<String, String> {
    save_pin(&app, window.label())
}

#[tauri::command]
pub fn pin_copy(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    copy_pin(&app, window.label())
}

#[tauri::command]
pub fn pin_close(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    close_pin(&app, window.label());
    Ok(())
}

/// Show the pin's right-click menu as a NATIVE OS context menu. An HTML menu is
/// clamped to the (image-sized) window, so on a short/narrow pin it was clipped;
/// a native menu floats above the window and is never cut off. Item ids encode the
/// pin label (`pin-menu|<label>|<action>`) so the app-global menu handler routes
/// each click back to the right pin. `(async)` keeps the blocking popup off the
/// main thread.
#[tauri::command(async)]
pub fn pin_context_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
    let label = window.label();
    let item = |action: &str, text: &str| {
        MenuItem::with_id(&app, format!("pin-menu|{label}|{action}"), text, true, None::<&str>)
    };
    let copy = item("copy", "Copy").map_err(|e| e.to_string())?;
    let save = item("save", "Save to Library").map_err(|e| e.to_string())?;
    let op100 = item("op100", "100%").map_err(|e| e.to_string())?;
    let op75 = item("op75", "75%").map_err(|e| e.to_string())?;
    let op50 = item("op50", "50%").map_err(|e| e.to_string())?;
    let op25 = item("op25", "25%").map_err(|e| e.to_string())?;
    let opacity = Submenu::with_id_and_items(
        &app,
        format!("pin-menu|{label}|opacity"),
        "Opacity",
        true,
        &[&op100, &op75, &op50, &op25],
    )
    .map_err(|e| e.to_string())?;
    let close = item("close", "Close").map_err(|e| e.to_string())?;
    let sep1 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?;
    let menu = Menu::with_items(&app, &[&copy, &save, &sep1, &opacity, &sep2, &close])
        .map_err(|e| e.to_string())?;
    window.popup_menu(&menu).map_err(|e| e.to_string())
}

/// Route a pin context-menu click (parsed from a `pin-menu|<label>|<action>` id) to
/// the matching pin. Called from the app-global menu-event handler in `lib.rs`.
/// Opacity is the pin's frontend CSS state, so it's delivered as an event the
/// PinApp applies; the payload carries the label because Tauri delivers events to
/// every window's listeners (see the one-shared-App gotcha).
pub fn handle_menu_action(app: &AppHandle, label: &str, action: &str) {
    use tauri::Emitter;
    let flash = |msg: &str| {
        let _ = app.emit_to(label, "pin-flash", serde_json::json!({ "label": label, "msg": msg }));
    };
    match action {
        "copy" => flash(if copy_pin(app, label).is_ok() { "Copied" } else { "Couldn't copy" }),
        "save" => flash(if save_pin(app, label).is_ok() { "Saved to Library" } else { "Couldn't save" }),
        "close" => close_pin(app, label),
        "op100" | "op75" | "op50" | "op25" => {
            let pct: u32 = action[2..].parse().unwrap_or(100);
            let _ = app.emit_to(label, "pin-opacity", serde_json::json!({ "label": label, "pct": pct }));
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_label_is_unique_and_prefixed() {
        let s = PinState::default();
        assert_eq!(s.next_label(), "pin-0");
        assert_eq!(s.next_label(), "pin-1");
        assert_eq!(s.next_label(), "pin-2");
    }

    #[test]
    fn insert_get_remove_roundtrip() {
        let s = PinState::default();
        s.insert("pin-0".into(), PinData { png: vec![1, 2, 3], width: 10, height: 20 });
        let got = s.get("pin-0").expect("present");
        assert_eq!(got.png, vec![1, 2, 3]);
        assert_eq!((got.width, got.height), (10, 20));
        s.remove("pin-0");
        assert!(s.get("pin-0").is_none());
    }

    #[test]
    fn forget_removes_entry() {
        let s = PinState::default();
        s.insert("pin-5".into(), PinData { png: vec![9], width: 1, height: 1 });
        forget(&s, "pin-5");
        assert!(s.get("pin-5").is_none());
    }

    #[test]
    fn capped_size_keeps_small_image_unchanged() {
        // 200x100 fits within 40% of 1920x1080 (768x432) → no scaling.
        let (w, h) = capped_size(200, 100, 1920.0, 1080.0, 0.4);
        assert_eq!((w.round() as u32, h.round() as u32), (200, 100));
    }

    #[test]
    fn capped_size_scales_large_image_preserving_aspect() {
        // 3840x2160 capped to 40% of 1920x1080 → 768x432 (16:9 preserved).
        let (w, h) = capped_size(3840, 2160, 1920.0, 1080.0, 0.4);
        assert_eq!((w.round() as u32, h.round() as u32), (768, 432));
    }
}
