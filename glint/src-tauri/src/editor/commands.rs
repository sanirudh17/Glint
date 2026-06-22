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
pub(crate) fn open_editor_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
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
