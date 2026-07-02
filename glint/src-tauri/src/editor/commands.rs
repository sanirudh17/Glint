use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::editor::{EditorSource, EditorState, PendingOpen};
use crate::editor::document;

#[derive(Serialize)]
pub struct EditorSourceDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
    pub origin: String,
    pub capture_id: Option<i64>,
    pub doc: Option<serde_json::Value>,
    pub project_path: Option<String>,
}

/// Show + focus the main window and tell it to navigate to /editor.
///
/// This relies on the main window being *hidden, never destroyed* (see the
/// CloseRequested handler in lib.rs, which calls `hide()` instead of closing):
/// its React app — and the `editor-open` listener in App.tsx — stay mounted, so
/// the event below always lands on a live listener. If the main window is ever
/// changed to truly close, this emit would fire into the void and the editor
/// would silently fail to open.
///
/// NOTE on the `editor-open` event: every window (main, HUD, overlay) loads the
/// same `index.html` and mounts the same `<App/>`, and Tauri's JS `listen()`
/// receives an event emitted to ANY target — so `emit_to("main", ...)` does NOT
/// actually stop the HUD/overlay listeners from firing. The real guard against
/// the window-hijack bug (HUD turning into a mini-annotator; the pre-warmed
/// overlay navigating to /editor and showing a stuck fullscreen annotator on the
/// next capture) lives in `App.tsx`: it only navigates when it is the "main"
/// window. We still `emit_to("main", ...)` here to express intent (main is the
/// only legitimate consumer).
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
    let _ = app.emit_to("main", "editor-open", ());
}

/// Set the editor source to a PNG and open/raise the editor window. Shared by the
/// from-last, from-Library, and tray-annotate paths.
pub fn set_source_and_open(
    app: &AppHandle,
    ed: &EditorState,
    png: Vec<u8>,
    width: u32,
    height: u32,
    origin: &str,
    capture_id: Option<i64>,
) {
    *ed.0.lock().unwrap() = Some(EditorSource {
        png,
        width,
        height,
        origin: origin.into(),
        capture_id,
        doc: None,
        project_path: None,
    });
    open_editor_window(app);
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
    crate::hud::teardown(&app);
    set_source_and_open(&app, &ed, png, width, height, "hud", None);
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
    set_source_and_open(&app, &ed, bytes, width, height, "library", Some(id));
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
        doc: s.doc.clone(),
        project_path: s.project_path.clone(),
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

/// "Done": flatten result → make it the current capture result + open the bottom-left
/// HUD, then hide the editor. Reuses the post-capture HUD (crate::hud) and
/// LastCaptureState — the same surfaces `editor_open_from_last` already uses.
#[tauri::command]
pub fn editor_done(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    png_base64: String,
) -> Result<(), String> {
    let bytes = decode_png_arg(&png_base64)?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (img.width(), img.height());
    let rgba = img.into_raw();

    // Temp PNG so the tray's drag-out / copy-path / reveal have a real file. Not yet
    // in the Library (saved=false) → the card shows Save, not Reveal.
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let dest = dir.join(format!("glint-edit-{ts}.png"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let path = dest.to_string_lossy().to_string();

    // Push the flattened result into the tray (build the card thumb first), then
    // mirror to LastCapture so "…_from_last" hotkeys still target it.
    {
        let thumb = crate::capture::thumb::make_thumb(&rgba, width, height, 240)
            .ok()
            .map(|png| {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                format!("data:image/png;base64,{b64}")
            })
            .unwrap_or_default();
        let evicted = {
            let tray = app.state::<crate::capture::tray::TrayState>();
            let mut store = tray.0.lock().unwrap();
            store.push(path.clone(), width, height, false, thumb).1
        };
        if let Some(ev) = evicted {
            if !ev.saved {
                let _ = std::fs::remove_file(&ev.path);
            }
        }
    }

    *last.0.lock().unwrap() = Some(crate::capture::LastCapture {
        path,
        width,
        height,
        rgba,
        saved: false,
    });

    // Building the tray webview must run OFF the main thread (window-build rule). Only
    // hide the editor if the tray actually came up, so a build failure never strands
    // the user with no window.
    let app2 = app.clone();
    std::thread::spawn(move || match crate::hud::ensure_open(&app2) {
        Ok(()) => {
            if let Some(win) = app2.get_webview_window("main") {
                let _ = win.hide();
            }
        }
        Err(e) => {
            log::error!("editor_done: hud open failed: {e}");
            let _ = app2.emit("glint-toast", "Couldn't open the result");
        }
    });
    Ok(())
}

// ─── Project (.glint) save/load ──────────────────────────────────────────────

/// Save the current editor document to a `.glint` file. The frontend supplies
/// the opaque `doc` (annotations + crop + frame) and the destination path (chosen
/// via the OS dialog). The base image is read from EditorState, so its bytes never
/// cross the IPC bridge as part of this call.
#[tauri::command]
pub fn project_save(
    app: AppHandle,
    ed: State<EditorState>,
    doc: serde_json::Value,
    path: String,
) -> Result<String, String> {
    // Ensure a .glint extension (the dialog usually adds it, but be defensive).
    let mut dest = std::path::PathBuf::from(&path);
    if dest.extension().and_then(|e| e.to_str()) != Some("glint") {
        dest.set_extension("glint");
    }

    let text = {
        let guard = ed.0.lock().unwrap();
        let s = guard.as_ref().ok_or("no editor source")?;
        let app_version = app.package_info().version.to_string();
        document::assemble(&s.png, s.width, s.height, doc, &app_version)?
    };

    std::fs::write(&dest, text.as_bytes()).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();
    // Record the path only AFTER a successful write, so a failed save can't leave
    // EditorState.project_path pointing at a file that was never created (which
    // would diverge from the frontend store and mislead a later silent Ctrl+S).
    if let Some(s) = ed.0.lock().unwrap().as_mut() {
        s.project_path = Some(dest_str.clone());
    }
    Ok(dest_str)
}

/// Open a `.glint` file into the editor: parse it, set EditorState (origin
/// "project", carrying the opaque doc + path), then show/focus the editor window.
#[tauri::command]
pub fn project_open(app: AppHandle, ed: State<EditorState>, path: String) -> Result<(), String> {
    let text = std::fs::read_to_string(&path)
        .map_err(|_| "Couldn't open this project — the file could not be read.".to_string())?;
    let parsed = document::parse(&text)?;
    *ed.0.lock().unwrap() = Some(EditorSource {
        png: parsed.png,
        width: parsed.width,
        height: parsed.height,
        origin: "project".into(),
        capture_id: None,
        doc: Some(parsed.doc),
        project_path: Some(path),
    });
    open_editor_window(&app);
    Ok(())
}

/// Supported source extensions, matching the `image` decode features and the
/// `image` perceived-type the shell verb is registered under.
const IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

/// The first argument that points to an existing file with a supported image
/// extension. Pure (no app handle) so it is unit-testable; used by both the
/// cold-start argv parse and the warm-start single-instance callback.
pub fn first_image_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| {
            let lower = a.to_lowercase();
            IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
                && std::path::Path::new(a).is_file()
        })
        .cloned()
}

/// Load an external image file into the editor as a new Untitled document.
/// Decodes the source, re-encodes to PNG (EditorState always holds PNG bytes),
/// sets origin "external" (no Library row, no doc, no project path). On `cold`
/// start, sets the PendingOpen flag so the frontend navigates on mount. Always
/// shows/focuses the editor window. Never modifies the source file.
pub fn open_image_path(app: &AppHandle, path: &str, cold: bool) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| {
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            format!("Couldn't open {name} — not a supported image")
        })?
        .to_rgba8();
    let (width, height) = (decoded.width(), decoded.height());
    let img = crate::capture::frozen::CapturedImage { width, height, rgba: decoded.into_raw() };
    let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;

    if let Some(ed) = app.try_state::<EditorState>() {
        *ed.0.lock().unwrap() = Some(EditorSource {
            png,
            width,
            height,
            origin: "external".into(),
            capture_id: None,
            doc: None,
            project_path: None,
        });
    }
    if cold {
        if let Some(p) = app.try_state::<PendingOpen>() {
            *p.0.lock().unwrap() = true;
        }
    }
    open_editor_window(app);
    Ok(())
}

/// One-shot: returns whether a cold-start external open is pending, resetting the
/// flag. The frontend calls this on mount to decide whether to navigate to /editor.
#[tauri::command]
pub fn consume_pending_external_open(pending: State<PendingOpen>) -> bool {
    let mut p = pending.0.lock().unwrap();
    let was = *p;
    *p = false;
    was
}

#[derive(Serialize)]
pub struct RecentProjectDto {
    pub path: String,
    pub name: String,
    pub exists: bool,
}

/// Resolve a list of `.glint` paths into display rows: basename + on-disk check.
/// Lets the frontend grey/prune stale entries without a filesystem plugin.
#[tauri::command]
pub fn projects_resolve(paths: Vec<String>) -> Vec<RecentProjectDto> {
    paths
        .into_iter()
        .map(|p| {
            let name = std::path::Path::new(&p)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone());
            let exists = std::path::Path::new(&p).is_file();
            RecentProjectDto { path: p, name, exists }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::first_image_arg;

    #[test]
    fn decode_png_arg_strips_data_url_prefix() {
        use base64::Engine;
        let raw = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let with_prefix = format!("data:image/png;base64,{raw}");
        assert_eq!(super::decode_png_arg(&with_prefix).unwrap(), b"hello");
        assert_eq!(super::decode_png_arg(&raw).unwrap(), b"hello");
    }

    #[test]
    fn ignores_when_no_image_arg() {
        let args = vec!["glint.exe".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }

    #[test]
    fn ignores_non_image_extension() {
        let args = vec!["glint.exe".to_string(), "C:\\notes.txt".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }

    #[test]
    fn finds_existing_image_file() {
        let dir = std::env::temp_dir();
        let p = dir.join("glint_test_arg.png");
        std::fs::write(&p, b"not really a png, just needs to exist").unwrap();
        let ps = p.to_string_lossy().to_string();
        let args = vec!["glint.exe".to_string(), ps.clone()];
        assert_eq!(first_image_arg(&args), Some(ps));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn ignores_image_extension_that_does_not_exist() {
        let args = vec!["glint.exe".to_string(), "C:\\nope_missing_xyz.png".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }
}
