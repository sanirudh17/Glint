pub mod commands;
pub mod cursor;
pub mod frozen;
pub mod geometry;
pub mod thumb;
pub mod tray;
pub mod windows_enum;

use crate::overlay;
use frozen::{CapturedImage, ScreenCapturer, XcapCapturer};
use geometry::PixelRect;
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use windows_enum::WindowInfo;

/// Monotonic id for capture sessions. Lets the background backdrop encoder
/// verify its pixels still belong to the live session before storing — a rapid
/// second capture must never receive the first capture's encoded frame.
static NEXT_CAPTURE_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug)]
pub enum CaptureMode {
    Area,
    Fullscreen,
    Window,
}

/// What a capture is FOR. Screenshot = the normal save/HUD pipeline; Text = OCR the
/// region and show the result panel (no file, no Library row).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CaptureIntent {
    Screenshot,
    Text,
}

impl FromStr for CaptureMode {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, ()> {
        match s {
            "area" => Ok(CaptureMode::Area),
            "fullscreen" => Ok(CaptureMode::Fullscreen),
            "window" => Ok(CaptureMode::Window),
            _ => Err(()),
        }
    }
}

impl CaptureMode {
    pub fn as_str(self) -> &'static str {
        match self {
            CaptureMode::Area => "area",
            CaptureMode::Fullscreen => "fullscreen",
            CaptureMode::Window => "window",
        }
    }
}

pub struct CaptureSession {
    // Kept for the per-monitor architecture; the single-monitor P2 path always
    // uses the primary (id 0) and commands clamp against the session image.
    #[allow(dead_code)]
    pub monitor_id: u32,
    pub image: CapturedImage,
    pub scale: f64,
    pub windows: Vec<WindowInfo>,
    pub mode: CaptureMode,
    /// True when this capture was started from the main-window UI (a quick-start
    /// button), which hid the main window first. On commit/cancel the commands
    /// re-show + focus the main window so it (and its taskbar icon) returns.
    /// False for hotkey/tray captures, which never touched the main window.
    pub restore_main: bool,
    /// What the committed region is FOR. Defaults to Screenshot; the Capture Text
    /// entry point re-tags it to Text after the session is built.
    pub intent: CaptureIntent,
    /// Identity for the background backdrop encoder (see `NEXT_CAPTURE_ID`).
    pub id: u64,
    /// Cached `data:image/png;base64,…` backdrop for the overlay, encoded ONCE per
    /// session on a background thread parallel with the window show. `None` until
    /// the encoder finishes; `capture_overlay_data` waits bounded for it, then
    /// falls back to a synchronous encode. Display-only — commits crop raw pixels.
    pub backdrop_url: Mutex<Option<std::sync::Arc<String>>>,
    /// Tiny crop of the frozen frame around the grab-time cursor, encoded
    /// synchronously (~ms, tens of KB) and served inside `capture_overlay_meta`
    /// so the loupe renders instantly — long before the full-frame image leg
    /// lands. `None` when the cursor is off-frame (other monitor) or unreadable;
    /// the loupe then simply waits for the full frame as before.
    pub loupe_patch: Option<LoupePatch>,
}

/// A tiny frozen-frame crop around the grab-time cursor for the instant loupe.
/// Coordinates are PHYSICAL px in frame space.
#[derive(Clone)]
pub struct LoupePatch {
    pub data_url: String,
    pub x: u32,
    pub y: u32,
    pub size: u32,
}

/// Side (physical px) of the square loupe patch. The loupe samples a 15px
/// window, so 128px covers ±56px of cursor travel — far more than the
/// stationary aiming the patch exists for — while staying tens of KB.
const LOUPE_PATCH_PX: u32 = 128;

/// Pure geometry half of the loupe patch: a `size`-clamped square centred on
/// the frame-space cursor, clamped into the frame. Unit-tested.
fn loupe_crop_rect(fx: f64, fy: f64, img_w: u32, img_h: u32) -> Option<PixelRect> {
    if fx < 0.0 || fy < 0.0 || fx >= img_w as f64 || fy >= img_h as f64 {
        return None;
    }
    let size = LOUPE_PATCH_PX.min(img_w).min(img_h);
    if size == 0 {
        return None;
    }
    let x = ((fx - size as f64 / 2.0).round() as i64).clamp(0, (img_w - size) as i64) as u32;
    let y = ((fy - size as f64 / 2.0).round() as i64).clamp(0, (img_h - size) as i64) as u32;
    geometry::clamp_rect(PixelRect { x, y, w: size, h: size }, img_w, img_h)
}

/// Crop + fast-PNG-encode + base64 a loupe patch around the live cursor.
/// Best-effort and synchronous (~ms): any failure degrades to `None` and the
/// loupe waits for the full frame. Must run after cursor compositing so the
/// patch matches the frozen frame pixel-for-pixel.
fn build_loupe_patch(
    app: &AppHandle,
    image: &CapturedImage,
    origin_x: i32,
    origin_y: i32,
) -> Option<LoupePatch> {
    let p = app.cursor_position().ok()?;
    let rect = loupe_crop_rect(
        p.x - origin_x as f64,
        p.y - origin_y as f64,
        image.width,
        image.height,
    )?;
    let rgba = geometry::crop_rgba(&image.rgba, image.width, image.height, rect);
    let patch = CapturedImage { width: rect.w, height: rect.h, rgba };
    let png = frozen::encode_png_fast(&patch).ok()?;
    use base64::Engine;
    Some(LoupePatch {
        data_url: format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&png)
        ),
        x: rect.x,
        y: rect.y,
        size: rect.w,
    })
}

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<CaptureSession>>);

/// The most recent committed capture — what the post-capture HUD acts on.
/// Holds the cropped pixels (for re-copy + thumbnail) plus the temp PNG path
/// (for drag-out / copy-path / save). Replaced on every commit.
#[derive(Clone)]
pub struct LastCapture {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

#[derive(Default)]
pub struct LastCaptureState(pub Mutex<Option<LastCapture>>);

/// Spawn [`begin`] on a fresh background thread.
///
/// Building the overlay `WebviewWindow` must NOT happen synchronously on the
/// main thread: sync Tauri commands and tray menu-event handlers run on the
/// main thread, and creating a webview there deadlocks the Windows event loop
/// (the build waits on the loop that is busy running the handler). Every
/// main-thread trigger MUST route through this so the build runs off-thread,
/// where the event loop is free to service it.
pub fn begin_spawned(app: &AppHandle, mode: CaptureMode) {
    let app = app.clone();
    std::thread::spawn(move || begin(&app, mode));
}

/// Delayed capture: show an N-second countdown (N from settings — 3/5/10), then run the
/// normal capture for `mode`. Off the main thread (building the countdown webview +
/// sleeping must not block the event loop). The countdown is the immediate visible
/// feedback; it's closed just before the grab so the digit never lands in the frame.
pub fn begin_delayed_spawned(app: &AppHandle, mode: CaptureMode) {
    let app = app.clone();
    std::thread::spawn(move || {
        let secs = app
            .state::<crate::settings::commands::SettingsState>()
            .0
            .lock()
            .unwrap()
            .capture_delay_secs;
        let _ = crate::countdown::build(&app, secs);
        std::thread::sleep(std::time::Duration::from_secs(secs as u64));
        // Close the digit BEFORE grabbing so it never bleeds into a fullscreen shot.
        crate::countdown::close(&app);
        begin(&app, mode);
    });
}

/// Serializes capture begins. Every hotkey press spawns its own thread, so a
/// second press (or a mash of presses when the first feels slow) would otherwise
/// run teardown→grab→show interleaved with the first: the two sessions share
/// process-global un-scoped `once` rendezvous (`overlay-ready`, `overlay-cleared`)
/// that can cross-consume, and a straggler teardown can hide a just-shown overlay —
/// surfacing as "pressed and nothing happened, then it suddenly popped up".
/// The first begin wins; overlapped presses are dropped with a log line (standard
/// hotkey debounce). Poison-safe: a poisoned lock is recovered, never wedged.
static BEGIN_IN_FLIGHT: Mutex<()> = Mutex::new(());

/// Entry point from hotkeys / tray. Leaves the main window untouched.
pub fn begin(app: &AppHandle, mode: CaptureMode) {
    begin_restoring(app, mode, false);
}

/// Begin a capture, recording whether the main window should be re-shown when the
/// capture settles. `restore_main` is true only for the main-window quick-start
/// buttons (which hid the main window first). Never panics; logs + toasts on
/// failure. Must run off the main thread (see [`begin_spawned`]).
pub fn begin_restoring(app: &AppHandle, mode: CaptureMode, restore_main: bool) {
    // Drop overlapped begins (see BEGIN_IN_FLIGHT): the grab→show sequence must
    // never run interleaved with itself across threads.
    let _in_flight = match BEGIN_IN_FLIGHT.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => {
            log::warn!("capture begin dropped: another capture is already starting");
            return;
        }
        Err(std::sync::TryLockError::Poisoned(inner)) => inner.into_inner(),
    };
    log::info!("capture begin: mode={}", mode.as_str());
    // Guard against double-begin: tear down any existing overlay first. The tray
    // (Quick Access Overlay) is NOT torn down here — a new capture is appended to
    // it (see finish_commit), so an in-progress stack survives across captures.
    overlay::teardown_all(app);

    let _perf = std::time::Instant::now();
    let capturer = XcapCapturer;
    let mut image = match capturer.capture_primary() {
        Ok(img) => img,
        Err(e) => {
            log::error!("capture failed: {e}");
            toast(app, "Couldn't capture screen");
            return;
        }
    };

    // Bake the cursor into the frozen frame when the user opted in.
    let include_cursor = app
        .state::<crate::settings::commands::SettingsState>()
        .0
        .lock()
        .unwrap()
        .include_cursor;
    let (ox, oy) = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| (m.position().x, m.position().y))
        .unwrap_or((0, 0));
    if include_cursor {
        cursor::composite_cursor(&mut image.rgba, image.width, image.height, ox, oy);
    }
    // Crop the instant-loupe patch AFTER compositing so it matches the frozen
    // frame pixel-for-pixel. Synchronous but tiny (~ms) — it rides the metadata
    // leg, not the show path.
    let loupe_patch = build_loupe_patch(app, &image, ox, oy);
    log::info!(
        "captured frozen frame: {}x{} [perf] screen grab: {}ms",
        image.width,
        image.height,
        _perf.elapsed().as_millis()
    );

    let monitor_id: u32 = 0; // single-monitor phase: primary keyed as 0

    // AppHandle::primary_monitor() exists in Tauri 2.11.3 (confirmed in app.rs:870).
    // Returns crate::Result<Option<Monitor>>; Monitor::scale_factor(&self) -> f64.
    let scale = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);

    let windows = if matches!(mode, CaptureMode::Window) {
        windows_enum::list_windows()
    } else {
        Vec::new()
    };

    let sid = NEXT_CAPTURE_ID.fetch_add(1, Ordering::SeqCst);

    // Kick off the backdrop encode on its own thread BEFORE showing: it runs
    // parallel with the window show + position, so the overlay's fetch (fired at
    // show) usually hits a warm cache instead of paying a full-screen PNG encode
    // + base64 on the visible path. The pixels are cloned (one fast memcpy) so
    // the encoder never contends with the session lock.
    {
        let app = app.clone();
        let pixels = image.rgba.clone();
        let (w, h) = (image.width, image.height);
        std::thread::spawn(move || {
            let t = std::time::Instant::now();
            let img = CapturedImage { width: w, height: h, rgba: pixels };
            let url = match frozen::encode_png_fast(&img) {
                Ok(png) => {
                    use base64::Engine;
                    Some(std::sync::Arc::new(format!(
                        "data:image/png;base64,{}",
                        base64::engine::general_purpose::STANDARD.encode(&png)
                    )))
                }
                Err(e) => {
                    log::warn!("backdrop encode failed (overlay will encode on fetch): {e}");
                    None
                }
            };
            if let Some(url) = url {
                if let Some(session) = app.state::<CaptureState>().0.lock().unwrap().as_ref() {
                    // Only store when this is still the live session — a rapid second
                    // capture must never receive the previous capture's frame.
                    if session.id == sid {
                        *session.backdrop_url.lock().unwrap() = Some(url);
                        log::info!("[perf] backdrop pre-encoded: {}ms", t.elapsed().as_millis());
                    }
                }
            }
        });
    }

    *app.state::<CaptureState>().0.lock().unwrap() = Some(CaptureSession {
        monitor_id,
        image,
        scale,
        windows,
        mode,
        restore_main,
        intent: CaptureIntent::Screenshot,
        id: sid,
        backdrop_url: Mutex::new(None),
        loupe_patch,
    });

    match overlay::open_for_monitor(app, monitor_id) {
        Ok(()) => log::info!(
            "capture overlay opened (scale={scale}) [perf] grab→overlay-shown: {}ms",
            _perf.elapsed().as_millis()
        ),
        Err(e) => {
            log::error!("overlay open failed: {e}");
            overlay::teardown_all(app);
            *app.state::<CaptureState>().0.lock().unwrap() = None;
            toast(app, "Couldn't open capture overlay");
        }
    }
}

/// Begin a Capture Text session: an Area capture whose committed region is OCR'd
/// instead of saved. Reuses the whole freeze/overlay path, then re-tags the freshly
/// built session's intent to Text (`begin_restoring` stores the session before it
/// returns). Must run off the main thread (it freezes + shows the overlay).
///
/// Hides the main window first (like `capture_start`) so Glint isn't baked into the
/// frozen frame, and gives the compositor a beat before freezing. `restore_main =
/// true` re-shows it once the capture settles.
pub fn begin_ocr_capture(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(200));
    begin_restoring(app, CaptureMode::Area, true);
    if let Some(session) = app.state::<CaptureState>().0.lock().unwrap().as_mut() {
        session.intent = CaptureIntent::Text;
    }
}

/// Spawn [`begin_ocr_capture`] on a background thread — the main-thread-safe entry
/// point for the tray "Capture Text" item (building the overlay on the main thread
/// deadlocks the event loop; see [`begin_spawned`]).
pub fn begin_ocr_capture_spawned(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || begin_ocr_capture(&app));
}

pub(crate) fn toast(app: &AppHandle, msg: &str) {
    let _ = app.emit("glint-toast", msg);
}

/// Re-show + focus the main window. Called when a capture that was started from
/// the main-window UI settles, so the window (and its taskbar icon) returns and
/// the success toast lands somewhere visible.
pub(crate) fn restore_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn parses_modes() {
        assert!(matches!(CaptureMode::from_str("area"), Ok(CaptureMode::Area)));
        assert!(matches!(CaptureMode::from_str("window"), Ok(CaptureMode::Window)));
        assert!(matches!(CaptureMode::from_str("fullscreen"), Ok(CaptureMode::Fullscreen)));
        assert!(CaptureMode::from_str("nope").is_err());
    }

    #[test]
    fn loupe_crop_centres_and_clamps() {
        // Centre of a 1080p frame: full-size square around the cursor.
        let r = loupe_crop_rect(960.0, 540.0, 1920, 1080).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (896, 476, 128, 128));
        // Top-left corner clamps into the frame.
        let r = loupe_crop_rect(0.0, 0.0, 1920, 1080).unwrap();
        assert_eq!((r.x, r.y), (0, 0));
        // Bottom-right corner clamps into the frame.
        let r = loupe_crop_rect(1919.0, 1079.0, 1920, 1080).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (1792, 952, 128, 128));
        // Cursor off-frame (other monitor) → no patch.
        assert!(loupe_crop_rect(-5.0, 100.0, 1920, 1080).is_none());
        assert!(loupe_crop_rect(2000.0, 100.0, 1920, 1080).is_none());
        // Frame smaller than the patch → whole frame.
        let r = loupe_crop_rect(50.0, 50.0, 100, 100).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (0, 0, 100, 100));
    }
}
