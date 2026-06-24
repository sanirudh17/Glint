//! "Pin to Screen": floating, always-on-top windows showing a captured image.
//!
//! One borderless `WebviewWindow` per pin (label `pin-<n>`), backed by this
//! in-memory registry mapping label → PNG bytes + dims. Mirrors the HUD/overlay
//! pattern (Rust state + a `*_data` command the webview fetches on mount). Pins
//! are EPHEMERAL — closing a pin or quitting Glint clears its bytes; nothing is
//! persisted. No recorder coupling.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

/// One pinned image's bytes + intrinsic size.
#[derive(Clone)]
pub struct PinData {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Session registry of live pins, keyed by window label, plus a label counter.
#[derive(Default)]
pub struct PinState {
    pub pins: Mutex<HashMap<String, PinData>>,
    pub counter: AtomicU64,
}

impl PinState {
    /// A fresh unique window label `pin-<n>`.
    pub fn next_label(&self) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        format!("pin-{n}")
    }

    pub fn insert(&self, label: String, data: PinData) {
        self.pins.lock().unwrap().insert(label, data);
    }

    pub fn get(&self, label: &str) -> Option<PinData> {
        self.pins.lock().unwrap().get(label).cloned()
    }

    pub fn remove(&self, label: &str) {
        self.pins.lock().unwrap().remove(label);
    }
}

/// Drop a pin's bytes when its window goes away (OS-driven close, etc.) so a
/// closed pin never leaks its image for the rest of the session.
pub fn forget(pins: &PinState, label: &str) {
    pins.remove(label);
}

/// Initial pin size in LOGICAL px: the image's natural size scaled DOWN to fit
/// within `cap_frac` of the monitor's logical size, aspect preserved. Never
/// upscales a small image. `mon_*` are logical px.
pub fn capped_size(nat_w: u32, nat_h: u32, mon_w: f64, mon_h: f64, cap_frac: f64) -> (f64, f64) {
    let nw = nat_w.max(1) as f64;
    let nh = nat_h.max(1) as f64;
    let scale = ((mon_w * cap_frac) / nw)
        .min((mon_h * cap_frac) / nh)
        .min(1.0);
    (nw * scale, nh * scale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn next_label_is_unique_and_prefixed() {
        let s = PinState::default();
        assert_eq!(s.next_label(), "pin-0");
        assert_eq!(s.next_label(), "pin-1");
        assert_eq!(s.next_label(), "pin-2");
    }

    #[test]
    fn insert_get_remove_roundtrip() {
        let s = PinState::default();
        s.insert("pin-0".into(), PinData { png: vec![1, 2, 3], width: 10, height: 20 });
        let got = s.get("pin-0").expect("present");
        assert_eq!(got.png, vec![1, 2, 3]);
        assert_eq!((got.width, got.height), (10, 20));
        s.remove("pin-0");
        assert!(s.get("pin-0").is_none());
    }

    #[test]
    fn forget_removes_entry() {
        let s = PinState::default();
        s.insert("pin-5".into(), PinData { png: vec![9], width: 1, height: 1 });
        forget(&s, "pin-5");
        assert!(s.get("pin-5").is_none());
    }

    #[test]
    fn capped_size_keeps_small_image_unchanged() {
        // 200x100 fits within 40% of 1920x1080 (768x432) → no scaling.
        let (w, h) = capped_size(200, 100, 1920.0, 1080.0, 0.4);
        assert_eq!((w.round() as u32, h.round() as u32), (200, 100));
    }

    #[test]
    fn capped_size_scales_large_image_preserving_aspect() {
        // 3840x2160 capped to 40% of 1920x1080 → 768x432 (16:9 preserved).
        let (w, h) = capped_size(3840, 2160, 1920.0, 1080.0, 0.4);
        assert_eq!((w.round() as u32, h.round() as u32), (768, 432));
    }
}
