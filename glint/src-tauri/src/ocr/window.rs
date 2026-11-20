//! Off-thread builder for the OCR review panel — a small NORMAL decorated window
//! (label `ocr`), unlike the transparent capture overlays. Built from async/spawned
//! contexts only (window-build rule). Single instance.
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OCR_LABEL: &str = "ocr";

static OPEN_REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static BUILD_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Open the OCR review panel for the latest result. The page reloads the text and,
/// once that frame is painted, calls `ocr_present` — so even the first open never
/// shows an empty transparent surface. Carries desktop acrylic when glass is on.
pub fn build_ocr_window(app: &AppHandle) -> tauri::Result<()> {
    OPEN_REQUESTED.store(true, std::sync::atomic::Ordering::SeqCst);
    if app.get_webview_window(OCR_LABEL).is_some() {
        let _ = app.emit_to(OCR_LABEL, "ocr-reload", ());
        return Ok(());
    }
    // Not pre-warmed yet: build hidden; the page presents itself once loaded.
    build_hidden(app)
}

/// Build the panel hidden at startup so the first open reuses a loaded page.
/// Off the main thread only (window-build rule). Idempotent.
pub fn prewarm(app: &AppHandle) {
    if app.get_webview_window(OCR_LABEL).is_none() {
        if let Err(error) = build_hidden(app) {
            log::warn!("OCR panel prewarm failed (will build on demand): {error}");
        }
    }
}

fn build_hidden(app: &AppHandle) -> tauri::Result<()> {
    let _building = BUILD_LOCK.lock().unwrap();
    if app.get_webview_window(OCR_LABEL).is_some() {
        return Ok(());
    }
    let dark = {
        let state = app.state::<crate::settings::commands::SettingsState>();
        let settings = state.0.lock().unwrap();
        match settings.theme {
            crate::settings::Theme::Light => false,
            crate::settings::Theme::Dark => true,
            crate::settings::Theme::System => app
                .get_webview_window("main")
                .and_then(|w| w.theme().ok())
                .is_none_or(|t| t != tauri::Theme::Light),
        }
    };
    let win = WebviewWindowBuilder::new(app, OCR_LABEL, WebviewUrl::App("index.html#/ocr".into()))
        .title("Glint — Captured Text")
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .resizable(true)
        .inner_size(460.0, 240.0)
        .min_inner_size(360.0, 180.0)
        .center()
        .focused(false)
        // Themed substrate until the page applies its material — never black/white.
        .background_color(if dark { tauri::window::Color(8, 8, 8, 255) } else { tauri::window::Color(246, 247, 249, 255) })
        .visible(false)
        .build()?;
    crate::window::protect_desktop_surface(&win);
    crate::window::disable_transitions(&win);
    Ok(())
}

/// Called by the panel once the requested text is painted: reveal it through the
/// paint gate (cloaked until a fresh frame and an active backdrop are ready).
#[tauri::command]
pub fn ocr_present(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != OCR_LABEL {
        return Err("Only the text panel can present this window".into());
    }
    if !OPEN_REQUESTED.swap(false, std::sync::atomic::Ordering::SeqCst) {
        return Ok(()); // a background prewarm load, not an open
    }
    crate::material::prepare_reveal(&window);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    crate::material::request_paint(&window);
    // Raise above the app that was active during the capture.
    let _ = window.set_always_on_top(true);
    let _ = window.set_always_on_top(false);
    Ok(())
}

/// Save the panel's text as a .txt file via a native Save dialog. Async: the
/// dialog blocks only this worker thread. Returns false if the user cancelled.
#[tauri::command(async)]
pub fn ocr_save_text(app: AppHandle, text: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let name = format!("Glint text {}.txt", chrono::Local::now().format("%Y-%m-%d at %H.%M.%S"));
    let Some(path) = app
        .dialog()
        .file()
        .set_title("Save text")
        .set_file_name(&name)
        .add_filter("Text", &["txt"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Couldn't save the text: {e}"))?;
    Ok(true)
}
