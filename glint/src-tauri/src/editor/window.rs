//! The standalone editor window. The annotation editor used to be a `/editor`
//! route inside the MAIN window (wrapped in the app shell's titlebar + nav rail);
//! it now lives in its own decorated, resizable OS window so it has room to breathe
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

fn builder(app: &AppHandle) -> WebviewWindowBuilder<'_, Wry, AppHandle> {
    WebviewWindowBuilder::new(app, EDITOR_LABEL, WebviewUrl::App("index.html#/editor".into()))
        .title("Glint")
        .inner_size(1180.0, 780.0)
        .min_inner_size(760.0, 540.0)
        .resizable(true)
        .center()
        .focused(true)
        // Dark substrate from the first frame — never white/black placeholder.
        .background_color(tauri::window::Color(12, 13, 15, 255))
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

    // Cold fallback (prewarm hasn't run / window was destroyed): show immediately.
    // The dark background_color paints before the webview's first frame, so there
    // is no white flash — just an instant dark window that fills with content.
    let win = builder(app).visible(true).build()?;
    // Kill OS open transition so editor snaps in instantly, not fading.
    crate::window::disable_transitions(&win);
    let _ = win.set_focus();
    Ok(())
}
