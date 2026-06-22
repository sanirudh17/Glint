use crate::capture::{
    geometry::{clamp_rect, crop_rgba, logical_to_physical, LogicalRect},
    CaptureState,
};
use crate::{clipboard, overlay};
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
pub struct WindowRectDto {
    pub id: u32,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Serialize)]
pub struct OverlayData {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub mode: String,
    pub image_data_url: String,
    pub windows: Vec<WindowRectDto>,
}

/// Returns the frozen screenshot + metadata the overlay UI needs to render.
#[tauri::command]
pub fn capture_overlay_data(
    _monitor_id: u32,
    state: State<CaptureState>,
) -> Result<OverlayData, String> {
    let guard = state.0.lock().unwrap();
    let session = guard.as_ref().ok_or("no active capture session")?;
    let png = crate::capture::frozen::encode_png(&session.image).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    // Convert window rects from physical px to logical px (divide by scale).
    let windows = session
        .windows
        .iter()
        .map(|w| WindowRectDto {
            id: w.id,
            x: w.x as f64 / session.scale,
            y: w.y as f64 / session.scale,
            w: w.w as f64 / session.scale,
            h: w.h as f64 / session.scale,
        })
        .collect();
    Ok(OverlayData {
        width: session.image.width,
        height: session.image.height,
        scale: session.scale,
        mode: session.mode.as_str().to_string(),
        image_data_url: format!("data:image/png;base64,{b64}"),
        windows,
    })
}

#[derive(serde::Deserialize)]
pub struct RectArg {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Commit a capture: crop the frozen screenshot to the selected rect, write a temp PNG,
/// copy to clipboard (non-fatal), and emit "capture-complete".
///
/// The overlay teardown + main-window restore happen up front, then the heavy work
/// (crop / PNG encode / file write / clipboard) runs on a background thread. This
/// command runs on the main thread, and the overlay's `close()` is only serviced by
/// the event loop AFTER this command returns — so doing the encode/write inline would
/// keep the overlay on screen for the whole duration. Spawning the work lets the
/// command return immediately, and the overlay vanishes the instant Enter is pressed.
#[tauri::command]
pub fn capture_commit(
    app: AppHandle,
    state: State<CaptureState>,
    rect: RectArg,
    _monitor_id: u32,
) -> Result<(), String> {
    // Take the session out — it won't be available after this.
    let session = { state.0.lock().unwrap().take() }.ok_or("no active capture session")?;
    overlay::teardown_all(&app);
    if session.restore_main {
        crate::capture::restore_main_window(&app);
    }

    let app2 = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = finish_commit(&app2, session, rect) {
            log::error!("capture commit failed: {e}");
            let _ = app2.emit("glint-toast", "Couldn't save capture");
        }
    });

    Ok(())
}

/// The heavy half of a commit: crop, encode, write, copy to clipboard, emit.
/// Runs off the main thread (see [`capture_commit`]).
fn finish_commit(
    app: &AppHandle,
    session: crate::capture::CaptureSession,
    rect: RectArg,
) -> Result<(), String> {
    let phys = logical_to_physical(
        LogicalRect { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        session.scale,
    );
    let clamped = clamp_rect(phys, session.image.width, session.image.height)
        .ok_or("empty selection")?;
    let cropped = crop_rgba(&session.image.rgba, session.image.width, session.image.height, clamped);

    // Write temp PNG under %LOCALAPPDATA%\com.glint.app\tmp\.
    // app.path() returns &PathResolver via the Manager trait (Tauri 2.11.3).
    // app_local_data_dir() -> Result<PathBuf> is available on desktop.
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let path = dir.join(format!("glint-{ts}.png"));

    let out_img = crate::capture::frozen::CapturedImage {
        width: clamped.w,
        height: clamped.h,
        rgba: cropped.clone(),
    };
    let png = crate::capture::frozen::encode_png(&out_img).map_err(|e| e.to_string())?;
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;

    // Copy to clipboard — non-fatal: log a warning but still emit capture-complete.
    let clip = clipboard::copy_image(&cropped, clamped.w, clamped.h);
    if let Err(ref e) = clip {
        log::warn!("clipboard copy failed: {e}");
    }

    // Emit capture-complete with path, dimensions, and clipboard success flag.
    app.emit(
        "capture-complete",
        serde_json::json!({
            "path": path.to_string_lossy(),
            "width": clamped.w,
            "height": clamped.h,
            "clipboard": clip.is_ok(),
        }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Cancel an in-progress capture: discard session, tear down overlays, and restore
/// the main window if this capture was started from the main-window UI.
#[tauri::command]
pub fn capture_cancel(app: AppHandle, state: State<CaptureState>) -> Result<(), String> {
    let session = state.0.lock().unwrap().take();
    overlay::teardown_all(&app);
    if session.map(|s| s.restore_main).unwrap_or(false) {
        crate::capture::restore_main_window(&app);
    }
    Ok(())
}
