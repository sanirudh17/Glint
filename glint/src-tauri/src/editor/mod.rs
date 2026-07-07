//! Annotation editor: the base-image source for the current editing session.
//! Set by the three entry points (HUD Annotate, Library Edit, open-in-editor);
//! read by the /editor webview via `editor_source`. No recorder dependency.

use std::sync::Mutex;

#[derive(Clone)]
pub struct EditorSource {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// "hud" | "library" | "capture" | "project" — informational for the frontend.
    pub origin: String,
    pub capture_id: Option<i64>,
    /// Present only when opened from a `.glint` project — the opaque editor doc.
    pub doc: Option<serde_json::Value>,
    /// The `.glint` path this session was opened from / last saved to (for silent Ctrl+S).
    pub project_path: Option<String>,
}

#[derive(Default)]
pub struct EditorState(pub Mutex<Option<EditorSource>>);

/// One-shot flag: a cold-start "Open in Glint" launch set an external image into
/// EditorState before the webview mounted. The frontend consumes this on mount to
/// navigate to /editor (the `editor-open` emit can race a not-yet-mounted listener
/// at cold start, so the flag — not the emit — drives cold-start navigation).
#[derive(Default)]
pub struct PendingOpen(pub Mutex<bool>);

pub mod commands;
pub mod document;
pub mod window;
