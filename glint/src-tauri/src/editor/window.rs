//! The standalone editor window. The annotation editor used to be a `/editor`
//! route inside the MAIN window (wrapped in the app shell's titlebar + nav rail);
//! it now lives in its own decorated, resizable OS window so it has room to breathe
//! and the user can use the main app alongside it. Built off the main thread
//! (window-build rule — a synchronous webview build on the main thread deadlocks the
//! event loop), so callers invoke `open_editor_window` which spawns for us.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const EDITOR_LABEL: &str = "editor";

/// Ensure the standalone editor window exists and is frontmost. If it's already
/// open, raise it (the caller then emits `editor-open` so its EditorView reloads the
/// new source); otherwise build it pointing at the chrome-free `#/editor` route — a
/// freshly-built window fetches its source on mount, so no emit is needed for it.
pub fn ensure_editor_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(EDITOR_LABEL) {
        let _ = win.unminimize();
        let _ = win.show();
        // Windows won't reliably raise a background window with show()+set_focus()
        // alone (OS foreground lock). A brief always-on-top toggle forces it front;
        // we drop the flag immediately so it behaves like a normal window after.
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
        let _ = win.set_always_on_top(false);
        return Ok(());
    }

    let url = WebviewUrl::App("index.html#/editor".into());
    WebviewWindowBuilder::new(app, EDITOR_LABEL, url)
        .title("Glint")
        .inner_size(1180.0, 780.0)
        .min_inner_size(760.0, 540.0)
        .resizable(true)
        .center()
        .focused(true)
        .build()?;
    Ok(())
}
