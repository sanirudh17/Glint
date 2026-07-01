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

use tauri::AppHandle;
use crate::recorder::RecordTarget;

/// A running FX session: the overlay window + the input-hook thread. Started with a
/// recording (when any effect is on) and torn down on stop/cancel.
pub struct FxSession {
    hooks: Option<hooks::HookHandle>,
}

/// Build the overlay (if any effect draws) and start the input hooks (if any effect
/// needs them). Safe to call off the main thread — it builds a WebView2 window.
pub fn start(app: &AppHandle, target: RecordTarget, cfg: FxConfig) -> FxSession {
    if cfg.needs_overlay() {
        let _ = window::build_fx_overlay(app, target);
    }
    let hooks = if cfg.needs_hooks() {
        Some(hooks::start_hooks(app.clone(), cfg))
    } else {
        None
    };
    FxSession { hooks }
}

impl FxSession {
    /// Stop the hooks (unhook + join) and destroy the overlay.
    pub fn stop(self, app: &AppHandle) {
        if let Some(h) = self.hooks {
            h.stop();
        }
        window::close_fx_overlay(app);
    }

    /// Restart the input hooks with a new config, leaving the overlay untouched.
    /// Used by live toggles — it (re)installs the keyboard hook when keystrokes
    /// flips on and refreshes the mouse hook's active-effect flags.
    pub fn restart_hooks(&mut self, app: &AppHandle, cfg: FxConfig) {
        if let Some(h) = self.hooks.take() {
            h.stop();
        }
        if cfg.needs_hooks() {
            self.hooks = Some(hooks::start_hooks(app.clone(), cfg));
        }
    }
}
