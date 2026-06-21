# Glint Phase 2 — Screenshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze-frame screenshot capture (Area / Fullscreen / Window) with a premium overlay, cropping to clipboard + temp PNG.

**Architecture:** The capture pipeline runs entirely in Rust tray-core. A trigger grabs the monitor with `xcap` into a frozen image, opens a transparent per-monitor overlay webview that renders the frozen image and drives selection in React, then Rust crops the frozen pixels and copies the result to the clipboard. Pure geometry/crop logic is isolated and unit-tested; capture/clipboard/overlay are thin Windows-facing shells.

**Tech Stack:** Tauri v2, Rust, `xcap` (still capture + window enumeration), `arboard` (image clipboard), `image`/`png` (encode), React 19 + TypeScript, React Router (hash), Konva is NOT used here (P5), Lucide icons, existing design tokens.

## Global Constraints

- Product/package/window/tray name is **Glint** everywhere. Accent `#5B7CFA`. Dark-primary, thin weights, 1px borders, single accent, Lucide icons. No purple gradients/glow/sparkle.
- **Local-first invariant:** no cloud, no accounts, no network calls, no auth. New crates must be offline.
- **Recorder isolation:** the capture path has ZERO compile-time or run-time dependency on ffmpeg or any recorder module.
- **Capture runs in tray-core** and must work with the main window hidden/closed.
- DB at `%APPDATA%\com.glint.app\glint.db`; temp working files under `%LOCALAPPDATA%\com.glint.app\tmp`; logs under `%LOCALAPPDATA%\com.glint.app\logs`.
- App-defined commands (via `generate_handler!`) need NO ACL permission; plugin JS APIs are ACL-gated.
- Tauri v2 global-shortcut: `ShortcutState::Pressed` only; `CmdOrCtrl+Shift+1` → CONTROL on Windows.
- Coordinate model: the overlay reports selection in **logical/CSS px**; Rust maps to **physical px** via the monitor `scale_factor`. The frozen image is physical px.
- No `captures` table writes in this phase (that is Phase 4). P2 output is clipboard + temp PNG only.

---

## File Structure

**Rust (new, under `glint/src-tauri/src/`):**
- `capture/mod.rs` — module root; orchestration (`begin`/`commit`/`cancel`), `CaptureSession` state, `CaptureMode`.
- `capture/geometry.rs` — **pure**: `LogicalRect`, `PixelRect`, `logical_to_physical`, `clamp_rect`, `depad`, `crop_rgba`. Unit-tested.
- `capture/frozen.rs` — `ScreenCapturer` trait + `XcapCapturer`; `CapturedImage`.
- `capture/windows_enum.rs` — `WindowInfo`, `list_windows`, pure `window_at` hit-test. Unit-tested.
- `capture/commands.rs` — `capture_commit`, `capture_cancel`, `capture_overlay_data` Tauri commands; `OverlayData`/`WindowRectDto` DTOs.
- `clipboard.rs` — `copy_image` via `arboard`.
- `overlay.rs` — `open_for_monitor`, `teardown_all` (per-monitor transparent webview lifecycle).

**Rust (modified):**
- `lib.rs` — register capture commands; manage `CaptureState`; mount `capture`/`overlay`/`clipboard` modules.
- `shortcuts.rs` — capture actions call `capture::begin` directly instead of emitting `shortcut-fired`.
- `tray.rs` — "Capture ▸" submenu items call `capture::begin`.
- `capabilities/overlay.json` (new) — capability for `overlay-*` windows.
- `tauri.conf.json` — no asset-protocol change needed (frozen image delivered as a data URL).

**Frontend (new, under `glint/src/`):**
- `overlay/OverlayApp.tsx` — overlay root: bootstraps `capture_overlay_data`, renders frozen image + active mode.
- `overlay/SelectionLayer.tsx` — dimmed surround, drag-create, 8 handles, move.
- `overlay/Crosshair.tsx`, `overlay/DimensionsBadge.tsx`, `overlay/Loupe.tsx`.
- `overlay/modes.ts` — mode state machine helpers (area/fullscreen/window), `Rect` type.
- `overlay/overlay.css` — overlay-specific styles (tokens-driven).
- `lib/captureIpc.ts` — typed wrappers for the capture commands/events.

**Frontend (modified):**
- `router.tsx` — add `#/overlay` route (no nav rail / titlebar chrome).
- `App.tsx` — listen for `capture-complete` → toast (replaces the capture-action shortcut toasts).

---

## Task 1: Pure geometry & crop core (TDD)

**Files:**
- Create: `glint/src-tauri/src/capture/mod.rs` (module decls only for now)
- Create: `glint/src-tauri/src/capture/geometry.rs`
- Modify: `glint/src-tauri/src/lib.rs` (add `mod capture;`)
- Test: inline `#[cfg(test)]` in `geometry.rs`

**Interfaces:**
- Produces:
  - `pub struct LogicalRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }`
  - `pub struct PixelRect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }`
  - `pub fn logical_to_physical(r: LogicalRect, scale: f64) -> PixelRect`
  - `pub fn clamp_rect(r: PixelRect, img_w: u32, img_h: u32) -> Option<PixelRect>` (None if zero-area)
  - `pub fn depad(src: &[u8], width: u32, height: u32, stride_bytes: usize) -> Vec<u8>`
  - `pub fn crop_rgba(packed: &[u8], img_w: u32, img_h: u32, r: PixelRect) -> Vec<u8>`

- [ ] **Step 1: Write failing tests** in `geometry.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_to_physical_scales_and_rounds() {
        let p = logical_to_physical(LogicalRect { x: 10.0, y: 20.0, w: 100.0, h: 50.0 }, 1.5);
        assert_eq!(p, PixelRect { x: 15, y: 30, w: 150, h: 75 });
    }

    #[test]
    fn logical_to_physical_identity_at_scale_one() {
        let p = logical_to_physical(LogicalRect { x: 3.0, y: 4.0, w: 5.0, h: 6.0 }, 1.0);
        assert_eq!(p, PixelRect { x: 3, y: 4, w: 5, h: 6 });
    }

    #[test]
    fn clamp_keeps_interior_rect() {
        let r = PixelRect { x: 10, y: 10, w: 20, h: 20 };
        assert_eq!(clamp_rect(r, 100, 100), Some(r));
    }

    #[test]
    fn clamp_trims_overflow() {
        let r = PixelRect { x: 90, y: 90, w: 50, h: 50 };
        assert_eq!(clamp_rect(r, 100, 100), Some(PixelRect { x: 90, y: 90, w: 10, h: 10 }));
    }

    #[test]
    fn clamp_rejects_zero_area() {
        assert_eq!(clamp_rect(PixelRect { x: 5, y: 5, w: 0, h: 10 }, 100, 100), None);
        assert_eq!(clamp_rect(PixelRect { x: 100, y: 0, w: 10, h: 10 }, 100, 100), None);
    }

    #[test]
    fn depad_removes_row_padding() {
        // 2x2 image, stride 12 bytes (8 used + 4 pad)
        let src = vec![
            1, 1, 1, 1, 2, 2, 2, 2, 9, 9, 9, 9,
            3, 3, 3, 3, 4, 4, 4, 4, 9, 9, 9, 9,
        ];
        let packed = depad(&src, 2, 2, 12);
        assert_eq!(packed, vec![1,1,1,1, 2,2,2,2, 3,3,3,3, 4,4,4,4]);
    }

    #[test]
    fn crop_extracts_subrect() {
        // 2x2 packed RGBA, crop bottom-right 1x1
        let packed = vec![1,1,1,1, 2,2,2,2, 3,3,3,3, 4,4,4,4];
        let out = crop_rgba(&packed, 2, 2, PixelRect { x: 1, y: 1, w: 1, h: 1 });
        assert_eq!(out, vec![4,4,4,4]);
    }
}
```

- [ ] **Step 2: Run, verify fail.** `cd glint/src-tauri && cargo test capture::geometry` → FAIL (functions undefined).

- [ ] **Step 3: Implement `geometry.rs`:**

```rust
//! Pure selection geometry & RGBA crop. No platform or Tauri deps — unit-tested.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LogicalRect { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PixelRect { pub x: u32, pub y: u32, pub w: u32, pub h: u32 }

/// Map an overlay (logical/CSS px) rect to physical pixels via the monitor scale.
pub fn logical_to_physical(r: LogicalRect, scale: f64) -> PixelRect {
    PixelRect {
        x: (r.x * scale).round() as u32,
        y: (r.y * scale).round() as u32,
        w: (r.w * scale).round() as u32,
        h: (r.h * scale).round() as u32,
    }
}

/// Clamp to image bounds; return None for a zero-area result.
pub fn clamp_rect(r: PixelRect, img_w: u32, img_h: u32) -> Option<PixelRect> {
    if r.x >= img_w || r.y >= img_h { return None; }
    let x = r.x.min(img_w);
    let y = r.y.min(img_h);
    let w = r.w.min(img_w - x);
    let h = r.h.min(img_h - y);
    if w == 0 || h == 0 { return None; }
    Some(PixelRect { x, y, w, h })
}

/// Remove per-row padding (stride may exceed width*4) into a packed RGBA buffer.
pub fn depad(src: &[u8], width: u32, height: u32, stride_bytes: usize) -> Vec<u8> {
    let row_used = (width as usize) * 4;
    if stride_bytes == row_used {
        return src[..row_used * height as usize].to_vec();
    }
    let mut out = Vec::with_capacity(row_used * height as usize);
    for row in 0..height as usize {
        let start = row * stride_bytes;
        out.extend_from_slice(&src[start..start + row_used]);
    }
    out
}

/// Crop a packed RGBA buffer to `r` (assumes `r` already clamped within bounds).
pub fn crop_rgba(packed: &[u8], img_w: u32, _img_h: u32, r: PixelRect) -> Vec<u8> {
    let row_bytes = (img_w as usize) * 4;
    let out_row = (r.w as usize) * 4;
    let mut out = Vec::with_capacity(out_row * r.h as usize);
    for row in 0..r.h as usize {
        let src_y = r.y as usize + row;
        let start = src_y * row_bytes + (r.x as usize) * 4;
        out.extend_from_slice(&packed[start..start + out_row]);
    }
    out
}
```

And in `capture/mod.rs`:

```rust
pub mod geometry;
```

And in `lib.rs`, add near the other `mod` lines: `mod capture;`

- [ ] **Step 4: Run, verify pass.** `cargo test capture::geometry` → all pass.

- [ ] **Step 5: Commit.**

```bash
git add glint/src-tauri/src/capture glint/src-tauri/src/lib.rs
git commit -m "feat(capture): pure geometry & crop core with tests"
```

---

## Task 2: Frozen-frame capture via xcap

**Files:**
- Create: `glint/src-tauri/src/capture/frozen.rs`
- Modify: `glint/src-tauri/src/capture/mod.rs` (add `pub mod frozen;`)
- Modify: `glint/src-tauri/Cargo.toml` (add `xcap`, `image`)
- Test: inline `#[cfg(test)]` in `frozen.rs` (pure parts only; real capture test `#[ignore]`)

**Interfaces:**
- Consumes: `geometry::depad`
- Produces:
  - `pub struct CapturedImage { pub width: u32, pub height: u32, pub rgba: Vec<u8> }` (packed RGBA)
  - `pub trait ScreenCapturer { fn capture_primary(&self) -> Result<CapturedImage, CaptureError>; }`
  - `pub struct XcapCapturer;` implementing it
  - `pub enum CaptureError { Backend(String) }` (impl `Display`)
  - `pub fn encode_png(img: &CapturedImage) -> Result<Vec<u8>, CaptureError>`

- [ ] **Step 1: Add deps.** In `Cargo.toml` `[dependencies]`:

```toml
xcap = "0.0.14"
image = { version = "0.25", default-features = false, features = ["png"] }
```

(If `xcap = "0.0.14"` fails to resolve, pin to the latest `0.0.x` that builds; record the pin in the progress ledger as the spike did for `windows-capture`.)

- [ ] **Step 2: Write the pure test** in `frozen.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_png_roundtrips_dimensions() {
        let img = CapturedImage { width: 2, height: 2, rgba: vec![255u8; 2 * 2 * 4] };
        let png = encode_png(&img).expect("encode");
        // PNG signature
        assert_eq!(&png[..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        let decoded = image::load_from_memory(&png).expect("decode");
        assert_eq!((decoded.width(), decoded.height()), (2, 2));
    }
}
```

- [ ] **Step 3: Run, verify fail.** `cargo test capture::frozen` → FAIL.

- [ ] **Step 4: Implement `frozen.rs`:**

```rust
//! Freeze-frame still capture. Windows-facing shell over `xcap`; the only
//! pure/tested piece is PNG encoding. ZERO recorder/ffmpeg dependency.

use crate::capture::geometry::depad;
use std::fmt;

pub struct CapturedImage { pub width: u32, pub height: u32, pub rgba: Vec<u8> }

#[derive(Debug)]
pub enum CaptureError { Backend(String) }

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self { CaptureError::Backend(m) => write!(f, "capture backend error: {m}") }
    }
}
impl std::error::Error for CaptureError {}

pub trait ScreenCapturer {
    fn capture_primary(&self) -> Result<CapturedImage, CaptureError>;
}

pub struct XcapCapturer;

impl ScreenCapturer for XcapCapturer {
    fn capture_primary(&self) -> Result<CapturedImage, CaptureError> {
        let monitors = xcap::Monitor::all().map_err(|e| CaptureError::Backend(e.to_string()))?;
        let monitor = monitors
            .into_iter()
            .find(|m| m.is_primary().unwrap_or(false))
            .ok_or_else(|| CaptureError::Backend("no primary monitor".into()))?;
        let rgba = monitor.capture_image().map_err(|e| CaptureError::Backend(e.to_string()))?;
        let (width, height) = (rgba.width(), rgba.height());
        // xcap returns an RgbaImage already packed; depad is a no-op when stride==width*4,
        // but we route through it to stay robust to padded buffers.
        let raw = rgba.into_raw();
        let stride = raw.len() / height as usize;
        let packed = depad(&raw, width, height, stride);
        Ok(CapturedImage { width, height, rgba: packed })
    }
}

pub fn encode_png(img: &CapturedImage) -> Result<Vec<u8>, CaptureError> {
    use image::{ImageEncoder, ColorType};
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(&img.rgba, img.width, img.height, ColorType::Rgba8.into())
        .map_err(|e| CaptureError::Backend(e.to_string()))?;
    Ok(out)
}
```

Add to `capture/mod.rs`: `pub mod frozen;`

- [ ] **Step 5: Run, verify pass + build.** `cargo test capture::frozen` → pass. `cargo build` → green.

- [ ] **Step 6: Commit.**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/capture
git commit -m "feat(capture): xcap freeze-frame capture + png encode"
```

---

## Task 3: Window enumeration & hit-testing

**Files:**
- Create: `glint/src-tauri/src/capture/windows_enum.rs`
- Modify: `glint/src-tauri/src/capture/mod.rs` (add `pub mod windows_enum;`)
- Test: inline `#[cfg(test)]` (pure `window_at`; real `list_windows` test `#[ignore]`)

**Interfaces:**
- Produces:
  - `pub struct WindowInfo { pub id: u32, pub title: String, pub app: String, pub x: i32, pub y: i32, pub w: u32, pub h: u32 }`
  - `pub fn window_at(windows: &[WindowInfo], x: i32, y: i32) -> Option<&WindowInfo>` (first = topmost)
  - `pub fn list_windows() -> Vec<WindowInfo>` (topmost first; empty on backend error)

- [ ] **Step 1: Write failing test:**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn w(id: u32, x: i32, y: i32, ww: u32, h: u32) -> WindowInfo {
        WindowInfo { id, title: String::new(), app: String::new(), x, y, w: ww, h }
    }
    #[test]
    fn topmost_window_wins_overlap() {
        let list = vec![w(1, 0, 0, 100, 100), w(2, 10, 10, 50, 50)];
        // list is topmost-first; point in both → id 1 (front)
        assert_eq!(window_at(&list, 20, 20).map(|x| x.id), Some(1));
    }
    #[test]
    fn point_outside_all_is_none() {
        let list = vec![w(1, 0, 0, 10, 10)];
        assert_eq!(window_at(&list, 999, 999).map(|x| x.id), None);
    }
}
```

- [ ] **Step 2: Run, verify fail.** `cargo test capture::windows_enum` → FAIL.

- [ ] **Step 3: Implement `windows_enum.rs`:**

```rust
//! Top-level window enumeration (Window capture mode) + pure hit-test.

#[derive(Clone, Debug)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app: String,
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

/// `windows` must be ordered topmost-first. Returns the first window containing the point.
pub fn window_at(windows: &[WindowInfo], x: i32, y: i32) -> Option<&WindowInfo> {
    windows.iter().find(|win| {
        x >= win.x && y >= win.y
            && x < win.x + win.w as i32
            && y < win.y + win.h as i32
    })
}

/// Enumerate top-level windows, topmost first. Returns empty on backend failure (caller
/// falls back to Area behaviour) — never panics.
pub fn list_windows() -> Vec<WindowInfo> {
    let windows = match xcap::Window::all() {
        Ok(w) => w,
        Err(e) => { log::warn!("window enumeration failed: {e}"); return Vec::new(); }
    };
    windows
        .into_iter()
        .filter(|win| !win.is_minimized().unwrap_or(true))
        .filter_map(|win| {
            Some(WindowInfo {
                id: win.id().ok()?,
                title: win.title().unwrap_or_default(),
                app: win.app_name().unwrap_or_default(),
                x: win.x().ok()?,
                y: win.y().ok()?,
                w: win.width().ok()?,
                h: win.height().ok()?,
            })
        })
        .collect()
}
```

Add to `capture/mod.rs`: `pub mod windows_enum;`

> NOTE for implementer: `xcap::Window` accessor names/`Result`-vs-value may differ by version. Adjust to the resolved `xcap` API; keep `list_windows` total (never panic) and topmost-first. Verify against `cargo doc -p xcap`.

- [ ] **Step 4: Run, verify pass + build.** `cargo test capture::windows_enum` → pass; `cargo build` → green.

- [ ] **Step 5: Commit.**

```bash
git add glint/src-tauri/src/capture
git commit -m "feat(capture): window enumeration + pure hit-test"
```

---

## Task 4: Image clipboard

**Files:**
- Create: `glint/src-tauri/src/clipboard.rs`
- Modify: `glint/src-tauri/src/lib.rs` (`mod clipboard;`)
- Modify: `glint/src-tauri/Cargo.toml` (add `arboard`)

**Interfaces:**
- Produces: `pub fn copy_image(rgba: &[u8], width: u32, height: u32) -> Result<(), String>`

- [ ] **Step 1: Add dep.** `Cargo.toml`: `arboard = "3"`

- [ ] **Step 2: Implement `clipboard.rs`:**

```rust
//! Image-to-clipboard via arboard. Non-fatal on failure (caller keeps the temp PNG).

pub fn copy_image(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Borrowed(rgba),
    })
    .map_err(|e| e.to_string())
}
```

Add `mod clipboard;` to `lib.rs`.

- [ ] **Step 3: Build.** `cargo build` → green. (No unit test — arboard needs a real clipboard; exercised in manual acceptance.)

- [ ] **Step 4: Commit.**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/clipboard.rs glint/src-tauri/src/lib.rs
git commit -m "feat(capture): arboard image clipboard"
```

---

## Task 5: Overlay window lifecycle + capability

**Files:**
- Create: `glint/src-tauri/src/overlay.rs`
- Create: `glint/src-tauri/capabilities/overlay.json`
- Modify: `glint/src-tauri/src/lib.rs` (`mod overlay;`)

**Interfaces:**
- Produces:
  - `pub fn open_for_monitor(app: &tauri::AppHandle, monitor_id: u32) -> tauri::Result<()>`
  - `pub fn teardown_all(app: &tauri::AppHandle)`
  - `pub const OVERLAY_PREFIX: &str = "overlay-";`

- [ ] **Step 1: Implement `overlay.rs`:**

```rust
//! Per-monitor transparent capture overlay windows. Always tear down via teardown_all
//! on every exit path so no invisible click-blocking window is ever left behind.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const OVERLAY_PREFIX: &str = "overlay-";

pub fn open_for_monitor(app: &AppHandle, monitor_id: u32) -> tauri::Result<()> {
    let label = format!("{OVERLAY_PREFIX}{monitor_id}");
    if app.get_webview_window(&label).is_some() {
        return Ok(()); // already open
    }
    let url = WebviewUrl::App(format!("index.html#/overlay?monitor={monitor_id}").into());
    let win = WebviewWindowBuilder::new(app, &label, url)
        .title("Glint Capture")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false) // shown after it positions to the monitor
        .build()?;

    // Cover the primary monitor (single-monitor phase). Multi-monitor: position per monitor.
    if let Some(monitor) = win.primary_monitor()? {
        let pos = monitor.position();
        let size = monitor.size();
        win.set_position(tauri::PhysicalPosition { x: pos.x, y: pos.y })?;
        win.set_size(tauri::PhysicalSize { width: size.width, height: size.height })?;
    }
    win.set_fullscreen(true)?;
    win.show()?;
    win.set_focus()?;
    Ok(())
}

pub fn teardown_all(app: &AppHandle) {
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with(OVERLAY_PREFIX))
        .cloned()
        .collect();
    for label in labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}
```

- [ ] **Step 2: Create `capabilities/overlay.json`:**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "overlay",
  "description": "Capability for transient capture overlay windows",
  "windows": ["overlay-*"],
  "permissions": ["core:default"]
}
```

Add `mod overlay;` to `lib.rs`.

- [ ] **Step 3: Build.** `cargo build` → green. (Behaviour verified in Task 11 end-to-end + manual.)

> NOTE: confirm `WebviewWindowBuilder` method names against the resolved Tauri 2.x (`shadow`, `set_fullscreen`, `primary_monitor` exist on 2.11). If `transparent(true)` requires the `macos-private-api`/`unstable` feature, it does NOT on Windows — Windows transparency works with `decorations(false)+transparent(true)`.

- [ ] **Step 4: Commit.**

```bash
git add glint/src-tauri/src/overlay.rs glint/src-tauri/capabilities/overlay.json glint/src-tauri/src/lib.rs
git commit -m "feat(capture): per-monitor overlay window lifecycle + capability"
```

---

## Task 6: Capture orchestration, session state & commands

**Files:**
- Modify: `glint/src-tauri/src/capture/mod.rs` (orchestration + `CaptureMode`, `CaptureState`)
- Create: `glint/src-tauri/src/capture/commands.rs`
- Modify: `glint/src-tauri/src/lib.rs` (manage state, register commands)
- Test: inline test for `CaptureMode` parse

**Interfaces:**
- Consumes: `geometry::*`, `frozen::{ScreenCapturer, XcapCapturer, CapturedImage, encode_png}`, `windows_enum::{WindowInfo, list_windows}`, `overlay`, `clipboard::copy_image`
- Produces:
  - `pub enum CaptureMode { Area, Fullscreen, Window }` + `FromStr`
  - `pub struct CaptureState(pub Mutex<Option<CaptureSession>>)` (managed)
  - `pub fn begin(app: &AppHandle, mode: CaptureMode)`
  - commands: `capture_overlay_data(monitor_id) -> OverlayData`, `capture_commit(rect, monitor_id)`, `capture_cancel()`
  - DTOs: `OverlayData { width, height, scale, image_data_url, windows: Vec<WindowRectDto>, mode }`, `WindowRectDto { id, x, y, w, h }` (logical px)

- [ ] **Step 1: Test for mode parse** (in `capture/mod.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    #[test]
    fn parses_modes() {
        assert!(matches!(CaptureMode::from_str("area"), Ok(CaptureMode::Area)));
        assert!(matches!(CaptureMode::from_str("window"), Ok(CaptureMode::Window)));
        assert!(matches!(CaptureMode::from_str("fullscreen"), Ok(CaptureMode::Fullscreen)));
        assert!(CaptureMode::from_str("nope").is_err());
    }
}
```

- [ ] **Step 2: Run, verify fail.** `cargo test capture::tests::parses_modes` → FAIL.

- [ ] **Step 3: Implement orchestration in `capture/mod.rs`:**

```rust
pub mod commands;
pub mod frozen;
pub mod geometry;
pub mod windows_enum;

use crate::{clipboard, overlay};
use frozen::{CapturedImage, ScreenCapturer, XcapCapturer};
use std::str::FromStr;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use windows_enum::WindowInfo;

#[derive(Clone, Copy, Debug)]
pub enum CaptureMode { Area, Fullscreen, Window }

impl FromStr for CaptureMode {
    type Err = ();
    fn from_str(s: &str) -> Result<Self, ()> {
        match s {
            "area" => Ok(CaptureMode::Area),
            "fullscreen" => Ok(CaptureMode::Fullscreen),
            "window" => Ok(CaptureMode::Window),
            _ => Err(()),
        }
    }
}
impl CaptureMode {
    pub fn as_str(self) -> &'static str {
        match self { CaptureMode::Area => "area", CaptureMode::Fullscreen => "fullscreen", CaptureMode::Window => "window" }
    }
}

pub struct CaptureSession {
    pub monitor_id: u32,
    pub image: CapturedImage,
    pub scale: f64,
    pub windows: Vec<WindowInfo>,
    pub mode: CaptureMode,
}

#[derive(Default)]
pub struct CaptureState(pub Mutex<Option<CaptureSession>>);

/// Entry point from hotkeys / tray. Never panics; logs + toasts on failure.
pub fn begin(app: &AppHandle, mode: CaptureMode) {
    // Guard against double-begin: if an overlay is open, tear it down and restart clean.
    overlay::teardown_all(app);

    let capturer = XcapCapturer;
    let image = match capturer.capture_primary() {
        Ok(img) => img,
        Err(e) => { log::error!("capture failed: {e}"); toast(app, "Couldn't capture screen"); return; }
    };
    let monitor_id: u32 = 0; // single-monitor phase: primary keyed as 0
    let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let windows = if matches!(mode, CaptureMode::Window) { windows_enum::list_windows() } else { Vec::new() };

    *app.state::<CaptureState>().0.lock().unwrap() = Some(CaptureSession {
        monitor_id, image, scale, windows, mode,
    });

    if let Err(e) = overlay::open_for_monitor(app, monitor_id) {
        log::error!("overlay open failed: {e}");
        overlay::teardown_all(app);
        *app.state::<CaptureState>().0.lock().unwrap() = None;
        toast(app, "Couldn't open capture overlay");
    }
}

pub(crate) fn toast(app: &AppHandle, msg: &str) {
    let _ = app.emit("glint-toast", msg);
}
```

- [ ] **Step 4: Implement `capture/commands.rs`:**

```rust
use crate::capture::{geometry::*, CaptureMode, CaptureState};
use crate::{clipboard, overlay};
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
pub struct WindowRectDto { pub id: u32, pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[derive(Serialize)]
pub struct OverlayData {
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub mode: String,
    pub image_data_url: String,
    pub windows: Vec<WindowRectDto>,
}

#[tauri::command]
pub fn capture_overlay_data(_monitor_id: u32, state: State<CaptureState>) -> Result<OverlayData, String> {
    let guard = state.0.lock().unwrap();
    let session = guard.as_ref().ok_or("no active capture session")?;
    let png = crate::capture::frozen::encode_png(&session.image).map_err(|e| e.to_string())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    // window rects → logical px (divide physical by scale)
    let windows = session.windows.iter().map(|w| WindowRectDto {
        id: w.id,
        x: w.x as f64 / session.scale,
        y: w.y as f64 / session.scale,
        w: w.w as f64 / session.scale,
        h: w.h as f64 / session.scale,
    }).collect();
    Ok(OverlayData {
        width: session.image.width,
        height: session.image.height,
        scale: session.scale,
        mode: session.mode.as_str().to_string(),
        image_data_url: format!("data:image/png;base64,{b64}"),
        windows,
    })
}

#[derive(serde::Deserialize)]
pub struct RectArg { pub x: f64, pub y: f64, pub w: f64, pub h: f64 }

#[tauri::command]
pub fn capture_commit(app: AppHandle, state: State<CaptureState>, rect: RectArg, _monitor_id: u32) -> Result<(), String> {
    let session = { state.0.lock().unwrap().take() }.ok_or("no active capture session")?;
    overlay::teardown_all(&app);

    let phys = logical_to_physical(LogicalRect { x: rect.x, y: rect.y, w: rect.w, h: rect.h }, session.scale);
    let clamped = clamp_rect(phys, session.image.width, session.image.height)
        .ok_or("empty selection")?;
    let cropped = crop_rgba(&session.image.rgba, session.image.width, session.image.height, clamped);

    // temp PNG
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    let path = dir.join(format!("glint-{ts}.png"));
    let out_img = crate::capture::frozen::CapturedImage { width: clamped.w, height: clamped.h, rgba: cropped.clone() };
    let png = crate::capture::frozen::encode_png(&out_img).map_err(|e| e.to_string())?;
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;

    // clipboard (non-fatal)
    let clip = clipboard::copy_image(&cropped, clamped.w, clamped.h);
    if let Err(e) = &clip { log::warn!("clipboard copy failed: {e}"); }

    app.emit("capture-complete", serde_json::json!({
        "path": path.to_string_lossy(),
        "width": clamped.w,
        "height": clamped.h,
        "clipboard": clip.is_ok(),
    })).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn capture_cancel(app: AppHandle, state: State<CaptureState>) -> Result<(), String> {
    *state.0.lock().unwrap() = None;
    overlay::teardown_all(&app);
    Ok(())
}
```

- [ ] **Step 5: Add deps + wire `lib.rs`.** `Cargo.toml`: `base64 = "0.22"`. In `lib.rs`: `.manage(crate::capture::CaptureState::default())` and add the three commands to `generate_handler!` alongside `settings_get_all, settings_set`. Import them: `use capture::commands::{capture_overlay_data, capture_commit, capture_cancel};`

- [ ] **Step 6: Run tests + build.** `cargo test` → all pass; `cargo build` → green; `cargo clippy --all-targets` → clean.

- [ ] **Step 7: Commit.**

```bash
git add glint/src-tauri
git commit -m "feat(capture): orchestration, session state, overlay/commit/cancel commands"
```

---

## Task 7: Wire triggers (shortcuts + tray) to capture::begin

**Files:**
- Modify: `glint/src-tauri/src/shortcuts.rs`
- Modify: `glint/src-tauri/src/tray.rs`
- Modify: `glint/src/App.tsx` (drop toasts for the three capture actions; keep others)

**Interfaces:**
- Consumes: `capture::{begin, CaptureMode}`

- [ ] **Step 1:** In `shortcuts.rs`, where the closure currently does `focus_main + emit("shortcut-fired", action)`, branch on the action: for `"capture_area" | "capture_window" | "capture_fullscreen"`, call `crate::capture::begin(&handle, mode)` (map action→`CaptureMode`) and do NOT focus the main window; for all other actions keep the existing `focus_main + emit` behaviour.

```rust
// inside the on_shortcut closure, after the Pressed check:
match action {
    "capture_area" => crate::capture::begin(&handle, crate::capture::CaptureMode::Area),
    "capture_window" => crate::capture::begin(&handle, crate::capture::CaptureMode::Window),
    "capture_fullscreen" => crate::capture::begin(&handle, crate::capture::CaptureMode::Fullscreen),
    other => {
        crate::window::focus_main(&handle);
        let _ = handle.emit("shortcut-fired", other);
    }
}
```

- [ ] **Step 2:** In `tray.rs`, the "Capture ▸" submenu items: on click, call `crate::capture::begin(app, mode)` for area/window/fullscreen. (If the submenu does not yet exist, add `Area` / `Window` / `Fullscreen` items under a "Capture" submenu and match their menu ids.)

- [ ] **Step 3:** In `App.tsx`, the `shortcut-fired` listener no longer receives capture actions, so its toast for them is dead — leave the listener (record/settings still use it) but ensure it does not error on the now-absent capture actions. No code change required if it just toasts whatever action string arrives.

- [ ] **Step 4: Build + manual smoke.** `cargo build` → green. `npm run tauri dev`, press `Ctrl+Shift+1` → an overlay window appears showing the frozen screen (selection UX lands in Tasks 8–11; for now confirm the window opens and `Esc` via Task 11 will close it — until then close via tray Quit).

- [ ] **Step 5: Commit.**

```bash
git add glint/src-tauri/src/shortcuts.rs glint/src-tauri/src/tray.rs glint/src/App.tsx
git commit -m "feat(capture): route hotkeys + tray to capture::begin"
```

---

## Task 8: Overlay app shell + frozen-image background

**Files:**
- Create: `glint/src/overlay/OverlayApp.tsx`
- Create: `glint/src/overlay/overlay.css`
- Create: `glint/src/overlay/modes.ts`
- Create: `glint/src/lib/captureIpc.ts`
- Modify: `glint/src/router.tsx` (add `#/overlay` route, chrome-free)

**Interfaces:**
- Produces (`captureIpc.ts`):
  - `type Rect = { x: number; y: number; w: number; h: number }`
  - `type WindowRect = { id: number; x: number; y: number; w: number; h: number }`
  - `type OverlayData = { width: number; height: number; scale: number; mode: "area"|"fullscreen"|"window"; imageDataUrl: string; windows: WindowRect[] }`
  - `getOverlayData(monitorId: number): Promise<OverlayData>` (invoke `capture_overlay_data`, maps `image_data_url`→`imageDataUrl`)
  - `commitCapture(rect: Rect, monitorId: number): Promise<void>` (invoke `capture_commit`)
  - `cancelCapture(): Promise<void>` (invoke `capture_cancel`)

- [ ] **Step 1: `captureIpc.ts`:**

```ts
import { invoke } from "@tauri-apps/api/core";

export type Rect = { x: number; y: number; w: number; h: number };
export type WindowRect = { id: number; x: number; y: number; w: number; h: number };
export type CaptureMode = "area" | "fullscreen" | "window";
export type OverlayData = {
  width: number; height: number; scale: number;
  mode: CaptureMode; imageDataUrl: string; windows: WindowRect[];
};

export async function getOverlayData(monitorId: number): Promise<OverlayData> {
  const d = await invoke<any>("capture_overlay_data", { monitorId });
  return {
    width: d.width, height: d.height, scale: d.scale, mode: d.mode,
    imageDataUrl: d.image_data_url, windows: d.windows,
  };
}
export const commitCapture = (rect: Rect, monitorId: number) =>
  invoke<void>("capture_commit", { rect, monitorId });
export const cancelCapture = () => invoke<void>("capture_cancel");
```

- [ ] **Step 2: `modes.ts`:** `Rect` re-export + helpers `normalizeRect(a, b): Rect` (from two corner points), `rectFromWindow(w): Rect`.

```ts
import type { Rect, WindowRect } from "../lib/captureIpc";
export type { Rect };
export function normalizeRect(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(ax - bx), h: Math.abs(ay - by) };
}
export const rectFromWindow = (w: WindowRect): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });
```

- [ ] **Step 3: `OverlayApp.tsx`:** read `monitor` from the hash query; `getOverlayData`; render the frozen `imageDataUrl` as a full-bleed fixed background; render the mode component (Task 9–12). Wire global `Esc` → `cancelCapture()`. Show nothing until data loads (transparent).

```tsx
import { useEffect, useState } from "react";
import { getOverlayData, cancelCapture, type OverlayData } from "../lib/captureIpc";
import "./overlay.css";

function useMonitorId(): number {
  const q = window.location.hash.split("?")[1] ?? "";
  return Number(new URLSearchParams(q).get("monitor") ?? "0");
}

export function OverlayApp() {
  const monitorId = useMonitorId();
  const [data, setData] = useState<OverlayData | null>(null);

  useEffect(() => { getOverlayData(monitorId).then(setData).catch(() => cancelCapture()); }, [monitorId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelCapture(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!data) return <div className="ov-root ov-empty" />;
  return (
    <div className="ov-root" style={{ backgroundImage: `url(${data.imageDataUrl})` }}>
      {/* Mode layer mounted here in Tasks 9–12 */}
    </div>
  );
}
```

- [ ] **Step 4: `overlay.css`:** `.ov-root` = fixed inset 0, `background-size: cover`, `cursor: crosshair`, `user-select: none`, `overflow: hidden`. `.ov-empty` transparent.

- [ ] **Step 5: Route.** In `router.tsx`, add a route for `/overlay` rendering `<OverlayApp/>` WITHOUT the app shell (no titlebar/nav rail). Ensure the existing app routes still render inside the shell layout.

- [ ] **Step 6: Build.** `npx tsc --noEmit` + `npx vite build` → clean. Manual: hotkey shows the frozen screen as a static image; `Esc` closes the overlay.

- [ ] **Step 7: Commit.**

```bash
git add glint/src/overlay glint/src/lib/captureIpc.ts glint/src/router.tsx
git commit -m "feat(overlay): overlay app shell + frozen-image background + Esc cancel"
```

> **Use the frontend-design skill** for Tasks 8–12 — the overlay must look genuinely premium (CleanShot-grade), not default.

---

## Task 9: Area selection — drag, dimmed surround, handles, move

**Files:**
- Create: `glint/src/overlay/SelectionLayer.tsx`
- Modify: `glint/src/overlay/OverlayApp.tsx` (mount for `mode === "area"`)
- Modify: `glint/src/overlay/overlay.css`

**Interfaces:**
- Consumes: `Rect`, `normalizeRect`, `commitCapture`
- Produces: `<SelectionLayer monitorId scale onCommit />` (internal to overlay)

- [ ] **Step 1:** Implement `SelectionLayer`: pointer-down starts a drag, pointer-move updates the rect via `normalizeRect`, pointer-up keeps the rect editable; render 4 dimmed panels around the selection (top/right/bottom/left) using absolute divs (the "hole" is the un-dimmed gap), a 1px accent border on the selection, and 8 resize handles. Dragging inside the selection moves it; dragging a handle resizes. A confirm affordance (double-click inside, or Enter) calls `commitCapture(rect, monitorId)`.

Key behaviour (real code for the core; styling per frontend-design skill):

```tsx
import { useRef, useState } from "react";
import { normalizeRect, type Rect } from "./modes";
import { commitCapture } from "../lib/captureIpc";

export function SelectionLayer({ monitorId }: { monitorId: number }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    setRect(normalizeRect(start.current.x, start.current.y, e.clientX, e.clientY));
  }
  function onPointerUp() { start.current = null; }
  function confirm() { if (rect && rect.w > 1 && rect.h > 1) commitCapture(rect, monitorId); }

  return (
    <div className="ov-layer" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
         onPointerUp={onPointerUp} onDoubleClick={confirm}
         onKeyDown={(e) => e.key === "Enter" && confirm()} tabIndex={0}>
      {rect && <SelectionBox rect={rect} />}
    </div>
  );
}
```

`SelectionBox` renders the dimmed surround (4 panels), the accent border, the resize handles, and (Task 10) the dimensions badge + crosshair, (Task 11) the loupe. Resize/move handlers update `rect`.

- [ ] **Step 2: Build + manual.** `tsc`/`vite` clean. Manual: drag a rectangle → surround dims, selection stays clear; Enter/double-click → toast "Copied to clipboard"; paste into Paint shows the exact region.

- [ ] **Step 3: Commit.** `git commit -m "feat(overlay): area selection with dimmed surround, handles, move/resize"`

---

## Task 10: Crosshair + dimensions badge

**Files:**
- Create: `glint/src/overlay/Crosshair.tsx`, `glint/src/overlay/DimensionsBadge.tsx`
- Modify: `SelectionLayer.tsx`, `overlay.css`

- [ ] **Step 1:** `Crosshair` — two 1px guide lines following the cursor (hidden once a selection exists, or kept subtle — frontend-design call). `DimensionsBadge` — shows `Math.round(w*scale) × Math.round(h*scale)` (physical px) near the selection corner, repositioning to stay on-screen.

- [ ] **Step 2:** Mount both inside `SelectionLayer`; pass cursor position + `rect` + `scale`.

- [ ] **Step 3: Build + manual.** Badge reads physical dimensions live during the drag; crosshair tracks before a drag starts.

- [ ] **Step 4: Commit.** `git commit -m "feat(overlay): crosshair guides + live dimensions badge"`

---

## Task 11: Magnifier loupe (zoom + hex)

**Files:**
- Create: `glint/src/overlay/Loupe.tsx`
- Modify: `SelectionLayer.tsx`, `overlay.css`

**Interfaces:**
- Consumes: the frozen `imageDataUrl` (decode once into an offscreen `HTMLImageElement`/`ImageBitmap`), cursor position, `scale`.

- [ ] **Step 1:** `Loupe` — a small canvas near the cursor. Decode the frozen image once into an `ImageBitmap`. On cursor move, `drawImage` a small physical-pixel source window (e.g. 16×16 physical px around the cursor) scaled up ~8× into the canvas with `imageSmoothingEnabled = false`; draw a centre crosshair cell; read the centre pixel via a 1×1 `getImageData` and render its `#RRGGBB` label.

```tsx
import { useEffect, useRef } from "react";

export function Loupe({ bitmap, cx, cy, scale }: { bitmap: ImageBitmap | null; cx: number; cy: number; scale: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv || !bitmap) return;
    const ctx = cv.getContext("2d")!; ctx.imageSmoothingEnabled = false;
    const srcN = 16; // physical px sampled
    const px = cx * scale, py = cy * scale;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(bitmap, px - srcN / 2, py - srcN / 2, srcN, srcN, 0, 0, cv.width, cv.height);
    // hex readout
    const cell = ctx.getImageData(cv.width / 2, cv.height / 2, 1, 1).data;
    const hex = "#" + [cell[0], cell[1], cell[2]].map((c) => c.toString(16).padStart(2, "0")).join("");
    // draw label + centre cell box per frontend-design
  }, [bitmap, cx, cy, scale]);
  return <canvas ref={ref} width={128} height={128} className="ov-loupe" />;
}
```

- [ ] **Step 2:** In `SelectionLayer`, decode `imageDataUrl` → `ImageBitmap` once (`createImageBitmap(await fetch(url).blob())`); pass to `Loupe` with cursor pos. Position the loupe offset from the cursor, flipping near screen edges.

- [ ] **Step 3: Build + manual.** Loupe shows magnified frozen pixels; hex matches the pixel under the crosshair (verify against a known colour).

- [ ] **Step 4: Commit.** `git commit -m "feat(overlay): magnifier loupe with hex readout"`

---

## Task 12: Fullscreen & Window mode controllers

**Files:**
- Create: `glint/src/overlay/FullscreenMode.tsx`, `glint/src/overlay/WindowMode.tsx`
- Modify: `OverlayApp.tsx` (switch on `data.mode`)

**Interfaces:**
- Consumes: `OverlayData.windows`, `window_at` equivalent in TS, `commitCapture`

- [ ] **Step 1: `FullscreenMode`** — the whole monitor is the target: show a subtle accent inset border + a "Press Enter to capture full screen" hint; Enter or click → `commitCapture({ x: 0, y: 0, w: width/scale, h: height/scale }, monitorId)` (logical px covering the monitor).

- [ ] **Step 2: `WindowMode`** — on pointer-move, hit-test `data.windows` (topmost-first, first containing point) and highlight that window's rect (accent border + dimmed surround); click → `commitCapture(rectFromWindow(hit), monitorId)`. TS hit-test mirrors Rust `window_at`.

```ts
export function windowAt(windows: WindowRect[], x: number, y: number): WindowRect | undefined {
  return windows.find((w) => x >= w.x && y >= w.y && x < w.x + w.w && y < w.y + w.h);
}
```

- [ ] **Step 3:** `OverlayApp` renders `SelectionLayer` / `FullscreenMode` / `WindowMode` by `data.mode`.

- [ ] **Step 4: Build + manual.** Fullscreen mode Enter → whole screen on clipboard. Window mode hover highlights windows; click captures that window.

- [ ] **Step 5: Commit.** `git commit -m "feat(overlay): fullscreen + window capture modes"`

---

## Task 13: End-to-end wiring, capture-complete toast, acceptance

**Files:**
- Modify: `glint/src/App.tsx` (listen `capture-complete` → toast; listen `glint-toast` → toast)
- Create: `docs/superpowers/PHASE-2-ACCEPTANCE.md`

- [ ] **Step 1:** In `App.tsx`, add listeners: `capture-complete` → toast `Copied to clipboard · {w}×{h}` (or `Saved (clipboard unavailable)` when `clipboard === false`); `glint-toast` (string payload) → toast. Use existing `pushToast`. Ensure unlisten cleanup.

- [ ] **Step 2: Full green gate.** Run all: `cargo test`, `cargo clippy --all-targets`, `npx tsc --noEmit`, `npx vite build`. All clean.

- [ ] **Step 3: Manual acceptance pass** (`npm run tauri dev`), record in `PHASE-2-ACCEPTANCE.md`:
  - Area: hotkey → freeze → drag → loupe+hex+dims correct → confirm → clipboard has exact region (paste-test, no colour swap).
  - Fullscreen: whole monitor to clipboard.
  - Window: hover highlights, click captures the window.
  - Esc cancels with no leftover overlay window; second hotkey while open behaves sanely.
  - Capture works with the main window closed to tray.
  - Temp PNG exists under `%LOCALAPPDATA%\com.glint.app\tmp`.
  - Log clean (no panics, no SQL/ACL denials).

- [ ] **Step 4: Commit.**

```bash
git add glint/src/App.tsx docs/superpowers/PHASE-2-ACCEPTANCE.md
git commit -m "feat(capture): capture-complete toast + Phase 2 acceptance"
```

---

## Self-Review notes (for the orchestrator)

- **Spec coverage:** modes (T9/T12), loupe+hex (T11), crosshair+dims (T10), per-monitor overlay arch (T5/T6), DPI mapping (T1/T6), clipboard (T4/T6), temp PNG (T6), tray-core ownership & triggers (T7), error handling (T6 toasts, T5 teardown), no captures-table writes (none added), recorder isolation (xcap-only — verify no ffmpeg pull), tests (T1/T2/T3/T6). Covered.
- **Type consistency:** `LogicalRect`/`PixelRect`/`CapturedImage`/`OverlayData`/`Rect`/`WindowRect` names are used identically across tasks. `capture_overlay_data`/`capture_commit`/`capture_cancel` command names match between `commands.rs`, `lib.rs` handler, and `captureIpc.ts`.
- **Version caveat:** `xcap` and Tauri `WebviewWindowBuilder`/monitor APIs may differ slightly by resolved version — each relevant task carries a NOTE to verify against installed docs and keep enumeration total (never panic).
- **Open risk to watch during build:** Windows transparent always-on-top overlay focus + input capture (Task 5/8) is the riskiest UI piece; if drag input misbehaves, that is the P0.5-style rough edge to surface early.
```
