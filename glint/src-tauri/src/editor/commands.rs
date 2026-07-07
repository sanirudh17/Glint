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

/// Open (or raise) the standalone editor window and put the main app window into the
/// taskbar, minimized, so the user can restore it anytime and use both side-by-side.
///
/// The editor lives in its OWN decorated window (label "editor"), not the main
/// window. Building a webview must happen OFF the main thread (a synchronous build on
/// the main thread deadlocks the event loop), so we spawn: build/raise the editor
/// window, then minimize main, then `emit_to("editor", "editor-open")`. A freshly
/// built editor window fetches its source on mount, so that emit is a harmless no-op
/// for it and a genuine reload trigger for an already-open one (reopen with a new
/// image). EditorState is already set by the caller before this runs, so the mount
/// fetch always sees the new source.
pub(crate) fn open_editor_window(app: &AppHandle) {
    use crate::editor::window::{ensure_editor_window, EDITOR_LABEL};
    let app = app.clone();
    std::thread::spawn(move || match ensure_editor_window(&app) {
        Ok(()) => {
            // Minimize (not hide) the main window so it stays in the taskbar and the
            // user can un-minimize it whenever they like (best-of-both-worlds).
            // show() first so a main window that was hidden (e.g. after a capture)
            // becomes taskbar-visible before it's minimized.
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.minimize();
            }
            let _ = app.emit_to(EDITOR_LABEL, "editor-open", ());
        }
        Err(e) => {
            log::error!("open_editor_window: build failed: {e}");
            let _ = app.emit("glint-toast", "Couldn't open the editor");
        }
    });
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
    let dir = crate::settings::locations::save_dir(&app, crate::settings::locations::SaveKind::Screenshot);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now(), "png");
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

    // Push the flattened result into the tray, then mirror to LastCapture so
    // "…_from_last" hotkeys still target it. Use the full-resolution PNG for the card
    // preview so it stays crisp under the card's object-fit: cover (a downscaled thumb
    // blurs).
    {
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let thumb = format!("data:image/png;base64,{b64}");
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
    });

    // Building the tray webview must run OFF the main thread (window-build rule). Only
    // close the editor window if the tray actually came up, so a build failure never
    // strands the user with no window. The main window is left minimized in the
    // taskbar (the user restores it from there) — Done doesn't touch it.
    let app2 = app.clone();
    std::thread::spawn(move || match crate::hud::ensure_open(&app2) {
        Ok(()) => {
            if let Some(win) = app2.get_webview_window(crate::editor::window::EDITOR_LABEL) {
                let _ = win.close();
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
