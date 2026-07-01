//! Recording FX — click / keystroke / cursor visual effects. ISOLATED: imports
//! nothing from capture/editor/overlay/ocr. gdigrab records the on-screen overlay
//! for free (webcam-bubble pattern); no ffmpeg-pipeline rewrite.

pub mod keymap;
pub mod window;
