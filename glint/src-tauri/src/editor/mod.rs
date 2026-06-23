//! Annotation editor: the base-image source for the current editing session.
//! Set by the three entry points (HUD Annotate, Library Edit, open-in-editor);
//! read by the /editor webview via `editor_source`. No recorder dependency.

use std::sync::Mutex;

#[derive(Clone)]
pub struct EditorSource {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// "hud" | "library" | "capture" — informational for the frontend.
    pub origin: String,
    pub capture_id: Option<i64>,
}

#[derive(Default)]
pub struct EditorState(pub Mutex<Option<EditorSource>>);

pub mod commands;
pub mod document;
