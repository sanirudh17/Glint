//! Recording FX — click / keystroke / cursor visual effects. ISOLATED: imports
//! nothing from capture/editor/overlay/ocr. gdigrab records the on-screen overlay
//! for free (webcam-bubble pattern); no ffmpeg-pipeline rewrite.

pub mod hooks;
pub mod keymap;
pub mod window;

/// Which effects are active for a recording. `cursor_hide` implies drawing our own
/// pointer (gdigrab draw_mouse off). `cursor_size`: 0 = off, 1 = large, 2 = xl.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FxConfig {
    pub click_viz: bool,
    pub keystrokes: bool,
    pub spotlight: bool,
    pub cursor_hide: bool,
    pub cursor_size: u8,
}

impl FxConfig {
    /// Any overlay-drawn effect active → we need the overlay + input hooks.
    pub fn needs_overlay(&self) -> bool {
        self.click_viz || self.keystrokes || self.spotlight || self.cursor_hide || self.cursor_size > 0
    }
    /// Any effect that needs the global input hooks (mouse/keyboard).
    pub fn needs_hooks(&self) -> bool {
        self.click_viz || self.keystrokes || self.spotlight || self.cursor_hide || self.cursor_size > 0
    }
    /// gdigrab should draw the OS cursor unless we're replacing it.
    pub fn draw_mouse(&self) -> bool {
        !(self.cursor_hide || self.cursor_size > 0)
    }
}
