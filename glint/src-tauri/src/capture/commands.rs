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
///
/// `(async)` runs this off the main thread: the backdrop encode would otherwise
/// block the event loop (and the overlay's own responsiveness) while it ran. The
/// backdrop is DISPLAY-ONLY — the committed capture crops the raw session pixels —
/// so it uses the fast (larger, identical-pixels) encoder.
#[tauri::command(async)]
pub fn capture_overlay_data(
    _monitor_id: u32,
    state: State<CaptureState>,
) -> Result<OverlayData, String> {
    let guard = state.0.lock().unwrap();
    let session = guard.as_ref().ok_or("no active capture session")?;
    let _perf = std::time::Instant::now();
    let png = crate::capture::frozen::encode_png_fast(&session.image).map_err(|e| e.to_string())?;
    let _enc = _perf.elapsed().as_millis();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    log::info!(
        "[perf] overlay_data: encode_png={_enc}ms total={}ms (png={}KB b64={}KB {}x{})",
        _perf.elapsed().as_millis(),
        png.len() / 1024,
        b64.len() / 1024,
        session.image.width,
        session.image.height
    );
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
        let result = match session.intent {
            crate::capture::CaptureIntent::Text => finish_ocr_commit(&app2, session, rect),
            crate::capture::CaptureIntent::Screenshot => finish_commit(&app2, session, rect),
        };
        if let Err(e) = result {
            log::error!("capture commit failed: {e}");
            let _ = app2.emit("glint-toast", "Couldn't save capture");
        }
    });

    Ok(())
}

/// The OCR half of a commit: crop the frozen region, run OCR, publish to the panel.
/// Cropping stays here (capture owns geometry); recognition is delegated to `ocr`.
fn finish_ocr_commit(
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
    match crate::ocr::recognize(&cropped, clamped.w, clamped.h) {
        Ok(out) => {
            crate::ocr::commands::publish_and_open(app, out);
            Ok(())
        }
        Err(e) => {
            let _ = app.emit("glint-toast", &e);
            Ok(()) // handled via toast; not a hard commit failure
        }
    }
}

/// The heavy half of a commit: crop, encode, write, copy to clipboard, emit.
/// Runs off the main thread (see [`capture_commit`]).
fn finish_commit(
    app: &AppHandle,
    session: crate::capture::CaptureSession,
    rect: RectArg,
) -> Result<(), String> {
    let _perf = std::time::Instant::now();
    let phys = logical_to_physical(
        LogicalRect { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        session.scale,
    );
    let clamped = clamp_rect(phys, session.image.width, session.image.height)
        .ok_or("empty selection")?;
    let cropped = crop_rgba(&session.image.rgba, session.image.width, session.image.height, clamped);

    let out_img = crate::capture::frozen::CapturedImage {
        width: clamped.w,
        height: clamped.h,
        rgba: cropped.clone(),
    };
    let png = crate::capture::frozen::encode_png_fast(&out_img).map_err(|e| e.to_string())?;
    log::info!(
        "[perf] commit encode_png: {}ms ({}x{})",
        _perf.elapsed().as_millis(),
        clamped.w,
        clamped.h
    );

    // Read the live settings (hydrated at startup).
    let (auto_save, auto_copy, open_in_editor) = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let s = state.0.lock().unwrap();
        (s.auto_save, s.auto_copy, s.open_in_editor)
    };

    // Decide where the durable file lives: auto-save → Pictures\Glint; otherwise a temp file.
    let (path, saved) = if auto_save {
        let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
        let dir = crate::paths::glint_save_dir(&pictures);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let filename = crate::paths::capture_filename(chrono::Local::now());
        let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
        std::fs::write(&dest, &png).map_err(|e| e.to_string())?;
        (dest, true)
    } else {
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dest = dir.join(format!("glint-{ts}.png"));
        std::fs::write(&dest, &png).map_err(|e| e.to_string())?;
        (dest, false)
    };
    let path_str = path.to_string_lossy().to_string();

    // Copy to clipboard (gated by auto_copy) — non-fatal: log a warning but carry on.
    let _cb = std::time::Instant::now();
    let clip = if auto_copy {
        clipboard::copy_image(&cropped, clamped.w, clamped.h)
    } else {
        Ok(())
    };
    if let Err(ref e) = clip {
        log::warn!("clipboard copy failed: {e}");
    }
    log::info!("[perf] commit clipboard copy: {}ms (auto_copy={auto_copy})", _cb.elapsed().as_millis());

    // Stash the result for the HUD to act on (re-copy / drag / save / copy-path /
    // reveal) BEFORE opening the HUD, so its mount-time fetch sees this capture.
    *app.state::<crate::capture::LastCaptureState>().0.lock().unwrap() =
        Some(crate::capture::LastCapture {
            path: path_str.clone(),
            width: clamped.w,
            height: clamped.h,
            rgba: cropped.clone(),
            saved,
        });

    // Open the HUD (or editor) NOW. The latest.png mirror and the Library
    // thumbnail+row are bookkeeping the HUD doesn't depend on, so they run AFTER on
    // a background thread (concurrent with the HUD's webview build) and never delay
    // it. The saved file itself was already written above, so the HUD's
    // reveal/drag/copy-path actions remain safe.
    if open_in_editor {
        // Skip the HUD — drop straight into the editor with this capture loaded.
        *app.state::<crate::editor::EditorState>().0.lock().unwrap() =
            Some(crate::editor::EditorSource {
                png: png.clone(),
                width: clamped.w,
                height: clamped.h,
                origin: "capture".into(),
                capture_id: None,
                doc: None,
                project_path: None,
            });
        crate::editor::commands::open_editor_window(app);
    } else {
        log::info!("[perf] commit work before HUD: {}ms", _perf.elapsed().as_millis());
        let _hud = std::time::Instant::now();
        let hud_result = crate::hud::open(app);
        log::info!(
            "[perf] hud::open (webview build+show): {}ms (commit total: {}ms)",
            _hud.elapsed().as_millis(),
            _perf.elapsed().as_millis()
        );
        if let Err(e) = hud_result {
            // HUD failed to open — fall back to the Phase 2 success toast.
            log::error!("hud open failed: {e}");
            app.emit(
                "capture-complete",
                serde_json::json!({
                    "path": path_str,
                    "width": clamped.w,
                    "height": clamped.h,
                    "clipboard": clip.is_ok(),
                }),
            )
            .map_err(|e| e.to_string())?;
        }
    }

    // Deferred Library/agent bookkeeping — runs off the HUD's critical path.
    {
        let app = app.clone();
        let png = png; // saved-file bytes (already on disk); reused for mirror + size
        let cropped = cropped; // full-res pixels for the thumbnail
        let path_str = path_str;
        std::thread::spawn(move || {
            // Mirror to %USERPROFILE%\.glint\latest.png for coding agents — non-fatal.
            if let Ok(home) = app.path().home_dir() {
                let latest = crate::paths::latest_png(&home);
                if let Some(parent) = latest.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if let Err(e) = std::fs::write(&latest, &png) {
                    log::warn!("latest.png mirror failed: {e}");
                }
            }
            // Record in the Library when auto-saved: thumbnail + DB row + event.
            if saved {
                let thumb_path = write_thumb(&app, &cropped, clamped.w, clamped.h, &path_str);
                let row = crate::db::NewCapture {
                    kind: "screenshot".into(),
                    path: path_str.clone(),
                    thumb_path,
                    width: Some(clamped.w as i64),
                    height: Some(clamped.h as i64),
                    bytes: Some(png.len() as i64),
                    created_at: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0),
                };
                let conn = app.state::<crate::Db>();
                let guard = conn.0.lock().unwrap();
                match crate::db::insert_capture(&guard, &row) {
                    Ok(_) => {
                        let _ = app.emit("capture-saved", ());
                    }
                    Err(e) => log::error!("insert_capture failed: {e}"),
                }
            }
        });
    }

    Ok(())
}

/// Write a thumbnail PNG into the app's thumbs dir and return its path. Non-fatal:
/// returns None on any failure (the Library card falls back to a placeholder tile).
pub(crate) fn write_thumb(app: &AppHandle, rgba: &[u8], w: u32, h: u32, src_path: &str) -> Option<String> {
    let png = crate::capture::thumb::make_thumb(rgba, w, h, 480).ok()?;
    let dir = app.path().app_local_data_dir().ok()?;
    let dir = crate::paths::thumbs_dir(&dir);
    std::fs::create_dir_all(&dir).ok()?;
    let stem = std::path::Path::new(src_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("thumb");
    let dest = dir.join(format!("{stem}.thumb.png"));
    std::fs::write(&dest, &png).ok()?;
    Some(dest.to_string_lossy().to_string())
}

// ─── Tray (Quick Access Overlay) commands ─────────────────────────────────────
use crate::capture::tray::{TrayItem, TrayState};

/// Decode a PNG file to RGBA (for clipboard/OCR/pin actions on a tray item).
fn read_rgba(path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    Ok((img.into_raw(), w, h))
}

fn tray_item(state: &TrayState, id: u64) -> Result<TrayItem, String> {
    state.0.lock().unwrap().get(id).ok_or_else(|| "no such capture".to_string())
}

#[tauri::command]
pub fn tray_list(state: State<TrayState>) -> Vec<TrayItem> {
    state.0.lock().unwrap().list()
}

#[tauri::command]
pub fn tray_copy(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let (rgba, w, h) = read_rgba(&it.path)?;
    clipboard::copy_image(&rgba, w, h)
}

#[tauri::command]
pub fn tray_copy_path(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    clipboard::copy_text(&it.path)
}

#[tauri::command]
pub fn tray_reveal(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    reveal_in_explorer(&it.path)
}

/// Save a tray item into the Library (no-op returning its path if already saved).
#[tauri::command]
pub fn tray_save(app: AppHandle, state: State<TrayState>, id: u64) -> Result<String, String> {
    let it = tray_item(&state, id)?;
    if it.saved {
        return Ok(it.path);
    }
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now());
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::copy(&it.path, &dest).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    // Curate into the Library: thumbnail + DB row + event (mirrors the old hud_save).
    let (rgba, w, h) = read_rgba(&dest_str)?;
    let thumb_path = write_thumb(&app, &rgba, w, h, &dest_str);
    let bytes = std::fs::metadata(&dest).map(|m| m.len() as i64).ok();
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let conn = app.state::<crate::Db>();
        let guard = conn.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&guard, &row) {
            log::error!("tray_save insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    state.0.lock().unwrap().mark_saved(id, dest_str.clone());
    Ok(dest_str)
}

#[tauri::command(async)]
pub fn tray_annotate(
    app: AppHandle,
    state: State<TrayState>,
    ed: State<crate::editor::EditorState>,
    id: u64,
) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let png = std::fs::read(&it.path).map_err(|e| e.to_string())?;
    crate::editor::commands::set_source_and_open(&app, &ed, png, it.width, it.height, "hud", None);
    Ok(())
}

#[tauri::command(async)]
pub fn tray_pin(
    app: AppHandle,
    state: State<TrayState>,
    pins: State<crate::pin::PinState>,
    id: u64,
) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let png = std::fs::read(&it.path).map_err(|e| e.to_string())?;
    crate::pin::pin_from_png_bytes(&app, &pins, png, it.width, it.height)
}

#[tauri::command(async)]
pub fn tray_extract_text(app: AppHandle, state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    crate::ocr::commands::ocr_recognize_path(&app, &it.path)
}

/// Remove one card; delete its temp file (never a saved Library file); close the
/// window when the tray goes empty.
#[tauri::command]
pub fn tray_dismiss(app: AppHandle, state: State<TrayState>, id: u64) -> Result<(), String> {
    let (removed, empty) = {
        let mut store = state.0.lock().unwrap();
        let removed = store.remove(id);
        (removed, store.is_empty())
    };
    if let Some(it) = removed {
        if !it.saved {
            let _ = std::fs::remove_file(&it.path);
        }
    }
    if empty {
        crate::hud::teardown(&app);
    }
    Ok(())
}

/// Empty the whole tray, delete every temp file, close the window.
#[tauri::command]
pub fn tray_clear(app: AppHandle, state: State<TrayState>) -> Result<(), String> {
    let removed = state.0.lock().unwrap().clear();
    for it in removed {
        if !it.saved {
            let _ = std::fs::remove_file(&it.path);
        }
    }
    crate::hud::teardown(&app);
    Ok(())
}

/// Resize + reposition the tray window to a new logical height, bottom-left-anchored
/// (fixed width). Called by the frontend as the stack grows/shrinks.
#[tauri::command]
pub fn tray_resize(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(crate::hud::HUD_LABEL) {
        let _ = win.set_size(tauri::LogicalSize::new(crate::hud::HUD_W, height));
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let scale = monitor.scale_factor();
            let pos = monitor.position();
            let size = monitor.size();
            let h_phys = (height * scale) as i32;
            let margin_x = (crate::hud::MARGIN_X * scale) as i32;
            let margin_y = (crate::hud::MARGIN_Y * scale) as i32;
            let x = pos.x + margin_x;
            let y = pos.y + size.height as i32 - h_phys - margin_y;
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
    }
    Ok(())
}

// ─── Library commands ─────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct CaptureListItem {
    pub id: i64,
    pub kind: String,
    pub path: String,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub bytes: Option<i64>,
    pub created_at: i64,
    /// base64 data URL of the thumbnail PNG, when one exists on disk.
    pub thumb_data_url: Option<String>,
}

/// List all (non-deleted) captures, newest first, with inlined thumbnail data URLs.
#[tauri::command]
pub fn captures_list(db: State<crate::Db>) -> Result<Vec<CaptureListItem>, String> {
    let conn = db.0.lock().unwrap();
    let rows = crate::db::list_captures(&conn).map_err(|e| e.to_string())?;
    let items = rows
        .into_iter()
        .map(|r| {
            let thumb_data_url = r.thumb_path.as_ref().and_then(|tp| {
                std::fs::read(tp).ok().map(|bytes| {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    format!("data:image/png;base64,{b64}")
                })
            });
            CaptureListItem {
                id: r.id,
                kind: r.kind,
                path: r.path,
                width: r.width,
                height: r.height,
                bytes: r.bytes,
                created_at: r.created_at,
                thumb_data_url,
            }
        })
        .collect();
    Ok(items)
}

fn path_for(db: &State<crate::Db>, id: i64) -> Result<String, String> {
    let conn = db.0.lock().unwrap();
    crate::db::capture_path(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "capture not found".to_string())
}

/// Like `path_for`, but also confirms the file is still on disk. The Library row
/// can outlive the file (the user moved/deleted it in Explorer), in which case
/// Open/Reveal/Copy would otherwise fail silently or send Explorer to the wrong
/// place — return a clear, user-facing message instead.
fn path_for_existing(db: &State<crate::Db>, id: i64) -> Result<String, String> {
    let path = path_for(db, id)?;
    if !std::path::Path::new(&path).exists() {
        return Err("This file is no longer on disk — it may have been moved or deleted.".into());
    }
    Ok(path)
}

/// Select a file in a fresh Explorer window.
///
/// Uses `raw_arg` so the path is quoted exactly — `explorer /select,"<path>"`.
/// Our save names contain spaces (`Glint 2026-… at ….png`); the normal `arg`
/// API would make Rust quote the whole `/select,…` token, which Explorer can't
/// parse — it then silently opens the default folder (Documents) instead of
/// selecting the file.
/// Spawn a child process without the fleeting black console window Windows pops for
/// `cmd`/`explorer` children (CREATE_NO_WINDOW = 0x0800_0000). Same flag the OCR path
/// uses. Without it, Open/Reveal flash a console for a split second.
fn no_window(cmd: &mut std::process::Command) -> &mut std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW)
}

fn reveal_in_explorer(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let mut cmd = std::process::Command::new("explorer");
    cmd.raw_arg(format!("/select,\"{path}\""));
    no_window(&mut cmd).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the capture in the OS default image viewer.
#[tauri::command]
pub fn capture_open(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for_existing(&db, id)?;
    let mut cmd = std::process::Command::new("cmd");
    cmd.args(["/C", "start", "", &path]);
    no_window(&mut cmd).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveal (select) the capture in Windows Explorer.
#[tauri::command]
pub fn capture_reveal(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for_existing(&db, id)?;
    reveal_in_explorer(&path)
}

/// Copy a Library item's absolute file path to the clipboard as text. Unlike
/// `capture_copy` (which decodes an image) this works for recordings too, and is
/// the handy way to reference a video file elsewhere (e.g. paste it to a tool).
#[tauri::command]
pub fn capture_copy_path(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for_existing(&db, id)?;
    clipboard::copy_text(&path)
}

/// Return the path to a 1×1 transparent PNG (created once in the cache dir), used
/// as the drag-out preview icon so dragging a capture/recording shows no big ghost
/// image — just the OS drag cursor. The drag plugin requires *some* icon path.
#[tauri::command]
pub fn drag_blank_icon(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("glint-drag-blank.png");
    if !p.exists() {
        image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 0]))
            .save(&p)
            .map_err(|e| e.to_string())?;
    }
    Ok(p.to_string_lossy().to_string())
}

/// Re-copy a Library capture image to the clipboard (decode PNG → rgba).
#[tauri::command]
pub fn capture_copy(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = path_for_existing(&db, id)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    clipboard::copy_image(&img.into_raw(), w, h)
}

/// Soft-delete a capture and remove its main file (best effort). Orphan thumbnails
/// are harmless and cleaned in a later pass.
#[tauri::command]
pub fn capture_delete(db: State<crate::Db>, id: i64) -> Result<(), String> {
    let path = {
        let conn = db.0.lock().unwrap();
        let p = crate::db::capture_path(&conn, id).map_err(|e| e.to_string())?;
        crate::db::soft_delete(&conn, id).map_err(|e| e.to_string())?;
        p
    };
    if let Some(p) = path {
        let _ = std::fs::remove_file(&p);
    }
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
