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

pub mod commands;
pub mod document;
