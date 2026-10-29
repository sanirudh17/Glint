//! The standalone editor window. The annotation editor used to be a `/editor`
//! route inside the MAIN window (wrapped in the app shell's titlebar + nav rail);
//! it now lives in its own resizable window with integrated toolbar controls so it has room to breathe
//! and the user can use the main app alongside it. Built off the main thread
//! (window-build rule — a synchronous webview build on the main thread deadlocks the
//! event loop), so callers invoke `open_editor_window` which spawns for us.
//!
//! The window is PRE-WARMED once at startup (hidden) and then reused: opening the
//! editor just shows + focuses it (and `editor-open` tells EditorView to reload the
//! source). Closing hides it instead of destroying it, so every subsequent open is
//! INSTANT — no WebView2 cold-build, no dark/blank first paint.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, Wry};

pub const EDITOR_LABEL: &str = "editor";
static PRESENT_PENDING:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
pub fn cancel_present(){PRESENT_PENDING.store(false,std::sync::atomic::Ordering::SeqCst);}

fn builder(app: &AppHandle) -> WebviewWindowBuilder<'_, Wry, AppHandle> {
    let (theme,accent)={
        let state=app.state::<crate::settings::commands::SettingsState>();
        let settings=state.0.lock().unwrap();
        (settings.theme.clone(),settings.accent.clone())
    };
    let light=match theme {
        crate::settings::Theme::Light=>true,
        crate::settings::Theme::Dark=>false,
        crate::settings::Theme::System=>app.get_webview_window("main").and_then(|w|w.theme().ok()).is_some_and(|t|t==tauri::Theme::Light),
    };
    let boot=format!("window.__GLINT_BOOT__ = {};",serde_json::json!({"theme":if light {"light"} else {"dark"},"accent":accent}));
    WebviewWindowBuilder::new(app, EDITOR_LABEL, WebviewUrl::App("index.html#/editor".into()))
        .title("Glint")
        .transparent(true)
        .decorations(false)
        .shadow(true)
        .inner_size(1180.0, 780.0)
        .min_inner_size(760.0, 540.0)
        .resizable(true)
        .center()
        .focused(false)
        .initialization_script(boot)
        // Dark substrate from the first frame — never white/black placeholder.
        .background_color(if light {tauri::window::Color(246,247,249,255)} else {tauri::window::Color(8,8,8,255)})
}

/// Build the editor window once, hidden, so the first "Annotate" click doesn't pay
/// the WebView2 cold-start. Idempotent. Safe from a spawned thread (window-build rule).
pub fn prewarm(app: &AppHandle) {
    if app.get_webview_window(EDITOR_LABEL).is_some() {
        return;
    }
    let win = match builder(app).visible(false).build() {
        Ok(w) => w,
        Err(e) => {
            log::warn!("editor prewarm failed (will build on demand): {e}");
            return;
        }
    };
    crate::window::disable_transitions(&win);
}

/// Ensure the standalone editor window exists and is frontmost. If it's already
/// open (or pre-warmed hidden), raise it (the caller then emits `editor-open` so
/// its EditorView reloads the new source); otherwise build it on demand.
pub fn ensure_editor_window(app: &AppHandle) -> tauri::Result<()> {
    PRESENT_PENDING.store(true,std::sync::atomic::Ordering::SeqCst);
    if let Some(win) = app.get_webview_window(EDITOR_LABEL) {
        // Reused webviews can still hold the previous canvas or material. Reload
        // while hidden; editor_present reveals the new completed frame.
        let _ = win.hide();
        return Ok(());
    }
    let win = builder(app).visible(false).build()?;
    crate::window::disable_transitions(&win);
    Ok(())
}

/// Called by this editor only after image, theme, material and paint are ready.
#[tauri::command]
pub fn editor_present(window:tauri::WebviewWindow)->Result<(),String>{
    if window.label()!=EDITOR_LABEL{return Err("Only the editor can present this window".into());}
    if !PRESENT_PENDING.swap(false,std::sync::atomic::Ordering::SeqCst){return Ok(());}
    let _=window.unminimize();
    window.show().map_err(|e|e.to_string())?;
    let _=window.set_always_on_top(true);
    let _=window.set_focus();
    let _=window.set_always_on_top(false);
    Ok(())
}
