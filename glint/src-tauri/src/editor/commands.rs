use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::editor::{EditorSource, EditorState};

#[derive(Serialize)]
pub struct EditorSourceDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub origin: String,
    pub capture_id: Option<i64>,
}

/// Show + focus the main window and tell it to navigate to /editor.
///
/// This relies on the main window being *hidden, never destroyed* (see the
/// CloseRequested handler in lib.rs, which calls `hide()` instead of closing):
/// its React app — and the `editor-open` listener in App.tsx — stay mounted, so
/// the event below always lands on a live listener. If the main window is ever
/// changed to truly close, this emit would fire into the void and the editor
/// would silently fail to open.
pub(crate) fn open_editor_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        // Windows won't reliably raise a hidden/background window with show() +
        // set_focus() alone (the OS foreground lock). A brief always-on-top
        // toggle forces it to the front; we immediately drop the topmost flag so
        // the window behaves normally afterward. Without this the editor opens
        // but stays behind whatever the user was looking at, so it feels like
        // "Annotate" did nothing.
        let _ = w.set_always_on_top(true);
        let _ = w.set_focus();
        let _ = w.set_always_on_top(false);
    }
    let _ = app.emit("editor-open", ());
}

/// Open the most recent capture (from the HUD) into the editor.
#[tauri::command]
pub fn editor_open_from_last(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    ed: State<EditorState>,
) -> Result<(), String> {
    let (png, width, height) = {
        let guard = last.0.lock().unwrap();
        let l = guard.as_ref().ok_or("no capture result")?;
        let img = crate::capture::frozen::CapturedImage {
            width: l.width,
            height: l.height,
            rgba: l.rgba.clone(),
        };
        let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
        (png, l.width, l.height)
    };
    *ed.0.lock().unwrap() = Some(EditorSource {
        png,
        width,
        height,
        origin: "hud".into(),
        capture_id: None,
    });
    crate::hud::teardown(&app);
    open_editor_window(&app);
    Ok(())
}

/// Open an existing Library capture (by id) into the editor.
#[tauri::command]
pub fn editor_open_capture(
    app: AppHandle,
    db: State<crate::Db>,
    ed: State<EditorState>,
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
    *ed.0.lock().unwrap() = Some(EditorSource {
        png: bytes,
        width,
        height,
        origin: "library".into(),
        capture_id: Some(id),
    });
    open_editor_window(&app);
    Ok(())
}

/// The base image + metadata the /editor webview loads on mount.
#[tauri::command]
pub fn editor_source(ed: State<EditorState>) -> Result<EditorSourceDto, String> {
    let guard = ed.0.lock().unwrap();
    let s = guard.as_ref().ok_or("no editor source")?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&s.png);
    Ok(EditorSourceDto {
        image_data_url: format!("data:image/png;base64,{b64}"),
        width: s.width,
        height: s.height,
        origin: s.origin.clone(),
        capture_id: s.capture_id,
    })
}

// ─── Export ────────────────────────────────────────────────────────────────────

/// Strip an optional `data:image/png;base64,` prefix, then decode to PNG bytes.
fn decode_png_arg(png_base64: &str) -> Result<Vec<u8>, String> {
    let raw = png_base64.rsplit(',').next().unwrap_or(png_base64);
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .map_err(|e| e.to_string())
}

/// Copy the flattened (annotated) image to the clipboard.
#[tauri::command]
pub fn editor_copy(png_base64: String) -> Result<(), String> {
    let bytes = decode_png_arg(&png_base64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    crate::clipboard::copy_image(&img.into_raw(), w, h)
}

/// Save the flattened image as a NEW capture in the Library (never overwrites).
#[tauri::command]
pub fn editor_save(app: AppHandle, db: State<crate::Db>, png_base64: String) -> Result<String, String> {
    let bytes = decode_png_arg(&png_base64)?;
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now());
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    let rgba_img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba_img.width(), rgba_img.height());
    let thumb_path = crate::capture::commands::write_thumb(&app, &rgba_img.into_raw(), w, h, &dest_str);
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes: Some(bytes.len() as i64),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("editor_save insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    Ok(dest_str)
}

/// Write the flattened image to a temp file and return its path (for drag-out).
#[tauri::command]
pub fn editor_flatten_temp(app: AppHandle, png_base64: String) -> Result<String, String> {
    let bytes = decode_png_arg(&png_base64)?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let dest = dir.join(format!("glint-edit-{ts}.png"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}
