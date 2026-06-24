# "Pin to Screen" (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin a capture as a floating, always-on-top window you can move, resize, fade, copy, save, and close — CleanShot's "Pin to Screen", session-only.

**Architecture:** One borderless `WebviewWindow` per pin (label `pin-<n>`), backed by an in-memory Rust `PinState` registry mapping label → PNG bytes + dims (mirrors the HUD/overlay pattern). A new chrome-free `/pin` React route renders `PinApp`, which fetches its image via `pin_data` (keyed by its own window label), and drives move/resize/opacity/copy/save/close. Opacity is plain CSS on the `<img>` (the window is already transparent) — no OS window-alpha API. Pins are ephemeral.

**Tech Stack:** Rust (Tauri v2, `image`, `base64`, existing DB/thumb/clipboard helpers), React 19 + TypeScript, Tauri window API (`getCurrentWindow`, `LogicalSize`).

## Global Constraints

- **Local-first:** no network/upload/accounts — in-memory bytes + local file read/write only.
- **Recorder isolation:** capture/library/image path only; zero recorder/ffmpeg/scap coupling.
- **No new dependencies.**
- **Ephemeral:** pin state is in-memory (`PinState`); closing a pin or quitting clears it. No on-disk pin state, no restore-on-launch.
- **Window label format:** exactly `pin-<n>` (monotonic counter from `PinState`).
- **Pin window flags:** borderless (`decorations(false)`), `transparent(true)`, `always_on_top(true)`, `skip_taskbar(true)`, `resizable(true)`, `shadow(false)`, `focused(false)`, built `visible(false)` then shown. **Interactive** (NOT focus-less like the HUD) — it receives pointer/wheel/context-menu events; built once and never hidden/reshown, so the WebView2 occlusion gotcha does not apply.
- **Initial size:** image natural size capped to **0.4** of the monitor's logical size, aspect preserved, never upscaled.
- **Resize clamps:** min **80** logical px; max = monitor logical size. Aspect always locked to the image's intrinsic ratio.
- **Opacity:** CSS opacity on the image; levels 100 / 75 / 50 / 25 %.
- **Right-click menu items (in order):** Copy · Save to Library · Opacity (100/75/50/25) · Close. Plus a hover **×** for quick close.
- **Route:** `/pin` is chrome-free (outside `AppShell`), like `/overlay` and `/hud`. The window URL is `index.html#/pin`.

---

### Task 1: Rust pin registry + pure helpers

**Files:**
- Create: `glint/src-tauri/src/pin.rs`
- Modify: `glint/src-tauri/src/lib.rs` (add `mod pin;` — keep the module list alphabetical: after `mod paths;`)

**Interfaces:**
- Produces:
  - `pub struct PinData { pub png: Vec<u8>, pub width: u32, pub height: u32 }` (derives `Clone`)
  - `pub struct PinState { pub pins: Mutex<HashMap<String, PinData>>, pub counter: AtomicU64 }` (derives `Default`)
  - `impl PinState`: `pub fn next_label(&self) -> String` (returns `pin-<n>`), `pub fn insert(&self, label: String, data: PinData)`, `pub fn get(&self, label: &str) -> Option<PinData>`, `pub fn remove(&self, label: &str)`
  - `pub fn capped_size(nat_w: u32, nat_h: u32, mon_w: f64, mon_h: f64, cap_frac: f64) -> (f64, f64)`
  - `pub fn forget(pins: &PinState, label: &str)`

- [ ] **Step 1: Write the failing tests**

Create `glint/src-tauri/src/pin.rs` with ONLY the test module below first (the items it references don't exist yet, so it won't compile — that's the RED state):

```rust
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd glint/src-tauri && cargo test pin::`
Expected: FAIL — `cannot find type PinState` / `function capped_size` etc.

- [ ] **Step 3: Implement the module body**

Prepend this above the test module in `glint/src-tauri/src/pin.rs`:

```rust
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
```

Then add the module declaration in `glint/src-tauri/src/lib.rs` (after `mod paths;`):

```rust
mod paths;
mod pin;
mod settings;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd glint/src-tauri && cargo test pin::`
Expected: PASS — 5 tests.

- [ ] **Step 5: Verify the build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds clean (the public fns/types are unused until Task 2 — `dead_code` warnings are acceptable for this task only).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/pin.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p7): PinState registry + capped_size/forget helpers"
```

---

### Task 2: Pin commands (window builder + create/data/save/copy/close)

**Files:**
- Modify: `glint/src-tauri/src/pin.rs` (append the command surface)

**Interfaces:**
- Consumes: `PinState`, `PinData`, `capped_size` (Task 1); `crate::capture::LastCaptureState` (`.0: Mutex<Option<LastCapture>>`, `LastCapture { path, width, height, rgba }`); `crate::capture::frozen::{CapturedImage { width, height, rgba }, encode_png(&CapturedImage) -> Result<Vec<u8>, _>}`; `crate::db::{capture_path, NewCapture, insert_capture}`; `crate::capture::commands::write_thumb(&AppHandle, &[u8], u32, u32, &str) -> Option<String>`; `crate::paths::{glint_save_dir, capture_filename, dedupe}`; `crate::clipboard::copy_image(&[u8], u32, u32) -> Result<(), String>`; `crate::Db`.
- Produces (Tauri commands): `pin_create_from_last`, `pin_create_from_capture(id: i64)`, `pin_data`, `pin_save`, `pin_copy`, `pin_close`; plus `PinDataDto { image_data_url, width, height }`.

- [ ] **Step 1: Add imports + the window builder**

Append to `glint/src-tauri/src/pin.rs` (after `capped_size`, before the test module). Add these imports at the TOP of the file (under the existing `use` lines):

```rust
use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
```

Then the builder + constants:

```rust
const PIN_CAP_FRAC: f64 = 0.4;
const CASCADE_STEP: f64 = 28.0; // logical px offset between successive pins

/// Build, position, size, and show one pin window. Size = the image capped to
/// `PIN_CAP_FRAC` of the primary monitor; position cascades by pin index so new
/// pins don't stack exactly. Interactive (focus(false) only avoids stealing
/// focus on creation; the window still receives pointer/wheel events).
fn build_pin_window(app: &AppHandle, label: &str, nat_w: u32, nat_h: u32) -> tauri::Result<()> {
    let url = WebviewUrl::App("index.html#/pin".into());
    let win = WebviewWindowBuilder::new(app, label, url)
        .title("Glint Pin")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false)
        .focused(false)
        .visible(false)
        .build()?;

    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let msize = monitor.size(); // physical px
        let mon_w = msize.width as f64 / scale;
        let mon_h = msize.height as f64 / scale;
        let (w, h) = capped_size(nat_w, nat_h, mon_w, mon_h, PIN_CAP_FRAC);
        let _ = win.set_size(tauri::LogicalSize::new(w, h));

        // Cascade from a base offset near the monitor's top-left.
        let pos = monitor.position(); // physical px
        let idx = label
            .strip_prefix("pin-")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let off = (idx % 8.0) * CASCADE_STEP * scale;
        let x = pos.x as f64 + 80.0 * scale + off;
        let y = pos.y as f64 + 80.0 * scale + off;
        let _ = win.set_position(tauri::PhysicalPosition::new(x as i32, y as i32));
    } else {
        log::warn!("pin: no primary monitor; using default window geometry");
    }

    win.show()?;
    Ok(())
}
```

- [ ] **Step 2: Add the create + data commands**

Append:

```rust
/// Pin the most recent capture (HUD "Pin" button).
#[tauri::command]
pub fn pin_create_from_last(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    pins: State<PinState>,
) -> Result<(), String> {
    let (png, width, height) = {
        let guard = last.0.lock().unwrap();
        let l = guard.as_ref().ok_or("no capture to pin")?;
        let img = crate::capture::frozen::CapturedImage {
            width: l.width,
            height: l.height,
            rgba: l.rgba.clone(),
        };
        let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
        (png, l.width, l.height)
    };
    let label = pins.next_label();
    pins.insert(label.clone(), PinData { png, width, height });
    build_pin_window(&app, &label, width, height).map_err(|e| e.to_string())
}

/// Pin a saved Library capture by id.
#[tauri::command]
pub fn pin_create_from_capture(
    app: AppHandle,
    db: State<crate::Db>,
    pins: State<PinState>,
    id: i64,
) -> Result<(), String> {
    let path = {
        let conn = db.0.lock().unwrap();
        crate::db::capture_path(&conn, id)
            .map_err(|e| e.to_string())?
            .ok_or("capture not found")?
    };
    if !std::path::Path::new(&path).exists() {
        return Err("This capture's file is no longer on disk — it may have been moved or deleted.".into());
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (decoded.width(), decoded.height());
    let img = crate::capture::frozen::CapturedImage { width, height, rgba: decoded.into_raw() };
    let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
    let label = pins.next_label();
    pins.insert(label.clone(), PinData { png, width, height });
    build_pin_window(&app, &label, width, height).map_err(|e| e.to_string())
}

/// The image a pin webview loads on mount, keyed by the CALLING window's label.
#[derive(Serialize)]
pub struct PinDataDto {
    pub image_data_url: String,
    pub width: u32,
    pub height: u32,
}

#[tauri::command]
pub fn pin_data(pins: State<PinState>, window: WebviewWindow) -> Result<PinDataDto, String> {
    let d = pins.get(window.label()).ok_or("no pin data for this window")?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&d.png);
    Ok(PinDataDto {
        image_data_url: format!("data:image/png;base64,{b64}"),
        width: d.width,
        height: d.height,
    })
}
```

- [ ] **Step 3: Add the save / copy / close commands**

Append:

```rust
/// Save this pin's image as a NEW Library capture (never overwrites). Reuses the
/// same write+thumb+insert+emit path as `editor_save`/`hud_save`.
#[tauri::command]
pub fn pin_save(
    app: AppHandle,
    db: State<crate::Db>,
    pins: State<PinState>,
    window: WebviewWindow,
) -> Result<String, String> {
    let d = pins.get(window.label()).ok_or("no pin data for this window")?;
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now());
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::write(&dest, &d.png).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    let rgba = image::load_from_memory(&d.png).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let thumb_path = crate::capture::commands::write_thumb(&app, &rgba.into_raw(), w, h, &dest_str);
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes: Some(d.png.len() as i64),
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|x| x.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let conn = db.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&conn, &row) {
            log::error!("pin_save insert_capture failed: {e}");
        }
    }
    let _ = tauri::Emitter::emit(&app, "capture-saved", ());
    Ok(dest_str)
}

/// Copy this pin's image to the clipboard (reuses `clipboard::copy_image`).
#[tauri::command]
pub fn pin_copy(pins: State<PinState>, window: WebviewWindow) -> Result<(), String> {
    let d = pins.get(window.label()).ok_or("no pin data for this window")?;
    let rgba = image::load_from_memory(&d.png).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    crate::clipboard::copy_image(&rgba.into_raw(), w, h)
}

/// Close this pin: drop its bytes and close the window.
#[tauri::command]
pub fn pin_close(app: AppHandle, pins: State<PinState>, window: WebviewWindow) -> Result<(), String> {
    let label = window.label().to_string();
    pins.remove(&label);
    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.close();
    }
    Ok(())
}
```

- [ ] **Step 4: Verify the build**

Run: `cd glint/src-tauri && cargo build && cargo test pin::`
Expected: builds clean (commands unused until Task 3 wiring — acceptable); the 5 Task-1 tests still pass.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/pin.rs
git commit -m "feat(p7): pin window builder + create/data/save/copy/close commands"
```

---

### Task 3: Wire pin into `lib.rs` (manage, handler, destroy cleanup)

**Files:**
- Modify: `glint/src-tauri/src/lib.rs` — imports, `.manage`, `invoke_handler`, `on_window_event`

**Interfaces:**
- Consumes: `pin::{pin_create_from_last, pin_create_from_capture, pin_data, pin_save, pin_copy, pin_close, PinState, forget}`.

- [ ] **Step 1: Import the pin commands**

In `glint/src-tauri/src/lib.rs`, after the `use shell_integration::{...};` line, add:

```rust
use pin::{
    pin_close, pin_copy, pin_create_from_capture, pin_create_from_last, pin_data, pin_save,
};
```

- [ ] **Step 2: Manage `PinState`**

After `.manage(crate::editor::PendingOpen::default())`, add:

```rust
        .manage(crate::pin::PinState::default())
```

- [ ] **Step 3: Clean up `PinState` when a pin window is destroyed**

In the existing `.on_window_event(|window, event| { ... })` closure, after the `CloseRequested` block, add a `Destroyed` handler:

```rust
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label();
                if label.starts_with("pin-") {
                    use tauri::Manager;
                    if let Some(pins) = window.try_state::<crate::pin::PinState>() {
                        crate::pin::forget(&pins, label);
                    }
                }
            }
```

- [ ] **Step 4: Register the six commands**

In the `invoke_handler![ … ]` list, after `shell_unregister_explorer_menu,`, add:

```rust
            pin_create_from_last,
            pin_create_from_capture,
            pin_data,
            pin_save,
            pin_copy,
            pin_close,
```

- [ ] **Step 5: Verify build + full test suite**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: builds clean (no unused-command warnings now); all tests pass (prior suite + 5 pin tests).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/lib.rs
git commit -m "feat(p7): manage PinState, register pin commands, destroy cleanup"
```

---

### Task 4: Frontend — `/pin` route, `PinApp`, styles, IPC wrappers

**Files:**
- Create: `glint/src/lib/pin.ts`, `glint/src/pin/PinApp.tsx`, `glint/src/pin/pin.css`
- Modify: `glint/src/router.tsx` (add the `/pin` route)

**Interfaces:**
- Consumes (Rust commands): `pin_data`, `pin_save`, `pin_copy`, `pin_close`.
- Produces: `getPinData()`, `pinCreateFromLast()`, `pinCreateFromCapture(id)`, `pinSave()`, `pinCopy()`, `pinClose()` (used by Task 5), and `<PinApp/>`.

- [ ] **Step 1: Add the IPC wrappers**

Create `glint/src/lib/pin.ts`:

```ts
/**
 * pin.ts — typed wrappers for the Pin-to-Screen Rust commands.
 * Local-first: only @tauri-apps/api. No recorder coupling.
 */
import { invoke } from "@tauri-apps/api/core";

export interface PinData {
  imageDataUrl: string;
  width: number;
  height: number;
}

interface RawPinData {
  image_data_url: string;
  width: number;
  height: number;
}

/** The current pin window's image (resolved by window label in Rust). */
export async function getPinData(): Promise<PinData> {
  const d = await invoke<RawPinData>("pin_data");
  return { imageDataUrl: d.image_data_url, width: d.width, height: d.height };
}

export const pinCreateFromLast = (): Promise<void> => invoke<void>("pin_create_from_last");
export const pinCreateFromCapture = (id: number): Promise<void> =>
  invoke<void>("pin_create_from_capture", { id });
export const pinSave = (): Promise<string> => invoke<string>("pin_save");
export const pinCopy = (): Promise<void> => invoke<void>("pin_copy");
export const pinClose = (): Promise<void> => invoke<void>("pin_close");
```

- [ ] **Step 2: Add the `/pin` route**

In `glint/src/router.tsx`, add the import next to the other chrome-free roots:

```tsx
import { HudApp } from "./hud/HudApp";
import { PinApp } from "./pin/PinApp";
```

And add a route object immediately after the `/hud` route object (before the `"/"` route):

```tsx
  {
    /**
     * Chrome-free pin route — a floating always-on-top image window. Like
     * /overlay and /hud it sits outside AppShell so PinApp is the sole root.
     * URL: tauri://localhost/#/pin (window label distinguishes each pin).
     */
    path: "/pin",
    element: <PinApp />,
  },
```

- [ ] **Step 3: Add the pin styles**

Create `glint/src/pin/pin.css`:

```css
/* Pin-to-Screen window — full-bleed image, chrome-free, on a transparent window. */
.pin-root {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  position: relative;
  background: transparent;
  user-select: none;
  cursor: default;
}

.pin-img {
  width: 100%;
  height: 100%;
  object-fit: fill;        /* window is sized to the image's aspect, so no distortion */
  display: block;
  -webkit-user-drag: none;
}

/* Quick-close × — top-right, revealed on hover. */
.pin-close {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}
.pin-root:hover .pin-close { opacity: 1; }

/* Corner resize handles — revealed on hover. */
.pin-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  opacity: 0;
  transition: opacity 120ms ease;
  z-index: 2;
}
.pin-root:hover .pin-handle { opacity: 1; }
.pin-handle--nw { top: 0; left: 0; cursor: nwse-resize; }
.pin-handle--ne { top: 0; right: 0; cursor: nesw-resize; }
.pin-handle--sw { bottom: 0; left: 0; cursor: nesw-resize; }
.pin-handle--se { bottom: 0; right: 0; cursor: nwse-resize; }
.pin-handle::after {
  content: "";
  position: absolute;
  inset: 4px;
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.35);
}

/* Custom right-click menu. */
.pin-menu {
  position: fixed;
  min-width: 168px;
  background: var(--bg-elev, #1c1c22);
  border: 1px solid var(--border-strong, #3a3a44);
  border-radius: 8px;
  padding: 4px;
  z-index: 10;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  color: var(--text, #e8e8ec);
  font-size: 13px;
}
.pin-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 5px;
  text-align: left;
}
.pin-menu-item:hover { background: var(--bg-elev2, #2a2a32); }
.pin-menu-sep { height: 1px; background: var(--border, #2c2c34); margin: 4px 2px; }
.pin-menu-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
.pin-menu-row-label { color: var(--text-dim, #9a9aa4); }
.pin-opacity-btn {
  border: 1px solid var(--border-strong, #3a3a44);
  background: transparent;
  color: inherit;
  border-radius: 4px;
  padding: 2px 6px;
  cursor: pointer;
  font-size: 12px;
}
.pin-opacity-btn--active { background: var(--accent, #5b7cfa); border-color: var(--accent, #5b7cfa); color: #fff; }

/* Inline confirmation flash. */
.pin-flash {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  opacity: 0;
  transition: opacity 120ms ease;
  pointer-events: none;
}
.pin-flash--show { opacity: 1; }
```

- [ ] **Step 4: Implement `PinApp`**

Create `glint/src/pin/PinApp.tsx`:

```tsx
/**
 * PinApp.tsx — root of a Pin-to-Screen window (route #/pin).
 *
 * A floating, always-on-top, chrome-free image. Drag the image to move it;
 * mouse-wheel or corner handles to resize (aspect locked); right-click for
 * Copy / Save to Library / Opacity / Close. Ephemeral — closing clears it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getPinData, pinSave, pinCopy, pinClose, type PinData } from "../lib/pin";
import { X } from "lucide-react";
import "./pin.css";

const MIN = 80;          // min logical px (any edge)
const OPACITIES = [100, 75, 50, 25];

type Menu = { x: number; y: number } | null;

export function PinApp() {
  const [data, setData] = useState<PinData | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [menu, setMenu] = useState<Menu>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  // Max logical size = the window's monitor; filled in on mount.
  const maxRef = useRef<{ w: number; h: number }>({ w: 4000, h: 4000 });

  // Fetch this pin's image on mount; if it's gone, close the window.
  useEffect(() => {
    getPinData().then(setData).catch(() => pinClose());
  }, []);

  // Cache the monitor's logical size for resize clamping.
  useEffect(() => {
    const w = getCurrentWindow();
    w.currentMonitor()
      .then((m) => {
        if (m) {
          maxRef.current = {
            w: m.size.width / m.scaleFactor,
            h: m.size.height / m.scaleFactor,
          };
        }
      })
      .catch(() => {});
  }, []);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1600);
  }, []);

  // Esc closes (works once the window has focus, e.g. after a click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pinClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const aspect = data ? data.width / data.height : 1;

  // Apply a new WIDTH (logical), deriving height from the locked aspect, clamped.
  const applyWidth = useCallback(
    async (rawW: number) => {
      const max = maxRef.current;
      let w = Math.max(MIN, Math.min(rawW, max.w));
      let h = w / aspect;
      if (h < MIN) { h = MIN; w = h * aspect; }
      if (h > max.h) { h = max.h; w = h * aspect; }
      await getCurrentWindow().setSize(new LogicalSize(Math.round(w), Math.round(h)));
    },
    [aspect],
  );

  // Move: drag the image (left button, not a handle).
  const onImgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    getCurrentWindow().startDragging().catch(() => {});
  };

  // Scroll to scale (aspect locked).
  const onWheel = async (e: React.WheelEvent) => {
    const cur = await getCurrentWindow().innerSize();
    const scale = await getCurrentWindow().scaleFactor();
    const curW = cur.width / scale;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    applyWidth(curW * factor);
  };

  // Corner handle drag → resize from the width delta.
  const onHandleDown = (e: React.PointerEvent, corner: "nw" | "ne" | "sw" | "se") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.screenX;
    getCurrentWindow().innerSize().then(async (sz) => {
      const scale = await getCurrentWindow().scaleFactor();
      const startW = sz.width / scale;
      const grows = corner === "ne" || corner === "se"; // dragging right edge outward grows
      const onMove = (m: PointerEvent) => {
        const dx = (m.screenX - startX) * (grows ? 1 : -1);
        applyWidth(startW + dx);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const doCopy = () => { setMenu(null); pinCopy().then(() => showFlash("Copied")).catch(() => showFlash("Couldn't copy")); };
  const doSave = () => { setMenu(null); pinSave().then(() => showFlash("Saved to Library")).catch(() => showFlash("Couldn't save")); };

  return (
    <div className="pin-root" onContextMenu={onContextMenu} onClick={() => menu && setMenu(null)}>
      {data && (
        <img
          className="pin-img"
          src={data.imageDataUrl}
          alt=""
          draggable={false}
          style={{ opacity }}
          onPointerDown={onImgPointerDown}
          onWheel={onWheel}
        />
      )}

      {(["nw", "ne", "sw", "se"] as const).map((c) => (
        <div
          key={c}
          className={`pin-handle pin-handle--${c}`}
          onPointerDown={(e) => onHandleDown(e, c)}
        />
      ))}

      <button
        type="button"
        className="pin-close"
        aria-label="Close pin"
        title="Close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => pinClose()}
      >
        <X size={13} strokeWidth={2} />
      </button>

      {menu && (
        <div className="pin-menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button className="pin-menu-item" onClick={doCopy}>Copy</button>
          <button className="pin-menu-item" onClick={doSave}>Save to Library</button>
          <div className="pin-menu-sep" />
          <div className="pin-menu-row">
            <span className="pin-menu-row-label">Opacity</span>
            {OPACITIES.map((p) => (
              <button
                key={p}
                className={`pin-opacity-btn${Math.round(opacity * 100) === p ? " pin-opacity-btn--active" : ""}`}
                onClick={() => { setOpacity(p / 100); setMenu(null); }}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="pin-menu-sep" />
          <button className="pin-menu-item" onClick={() => pinClose()}>Close</button>
        </div>
      )}

      <div className={`pin-flash${flash ? " pin-flash--show" : ""}`} aria-live="polite">{flash}</div>
    </div>
  );
}
```

- [ ] **Step 5: Verify types + build**

Run: `cd glint && npx tsc --noEmit && npx vite build`
Expected: tsc clean; vite build clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/pin.ts glint/src/pin/PinApp.tsx glint/src/pin/pin.css glint/src/router.tsx
git commit -m "feat(p7): /pin route + PinApp (move/resize/opacity/copy/save/close)"
```

---

### Task 5: Entry points — HUD Pin button + Library card

**Files:**
- Modify: `glint/src/hud/HudApp.tsx` (replace the stubbed `case "pin"`)
- Modify: `glint/src/views/library/CaptureCard.tsx` (add a Pin action button)

**Interfaces:**
- Consumes: `pinCreateFromLast`, `pinCreateFromCapture` (Task 4).

- [ ] **Step 1: Wire the HUD Pin button**

In `glint/src/hud/HudApp.tsx`, add the import (next to `openEditorFromLast`):

```tsx
import { openEditorFromLast } from "../lib/editor";
import { pinCreateFromLast } from "../lib/pin";
```

Replace the stubbed pin case:

```tsx
        case "pin":
          flash("Pinning arrives in Phase 7");
          break;
```

with:

```tsx
        case "pin":
          await pinCreateFromLast().then(() => flash("Pinned")).catch(() => flash("Couldn't pin"));
          break;
```

- [ ] **Step 2: Add the Library card Pin button**

In `glint/src/views/library/CaptureCard.tsx`, extend the icon import and add the wrapper import:

```tsx
import { ExternalLink, FolderOpen, Copy, Pencil, Pin, Trash2 } from "lucide-react";
import { pinCreateFromCapture } from "../../lib/pin";
```

Add a Pin button in the `.cap-actions` row, immediately before the Delete button:

```tsx
        <button className="cap-btn" aria-label="Pin to screen" title="Pin to screen" onClick={() => act(() => pinCreateFromCapture(item.id))}>
          <Pin size={15} strokeWidth={1.75} />
        </button>
        <button
          className="cap-btn cap-btn--danger"
```

- [ ] **Step 3: Verify types + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; vitest green (no new frontend unit tests); vite build clean.

- [ ] **Step 4: Commit**

```bash
git add glint/src/hud/HudApp.tsx glint/src/views/library/CaptureCard.tsx
git commit -m "feat(p7): pin from HUD button + Library card"
```

---

### Task 6: Green gate + acceptance + roadmap

**Files:**
- Create: `docs/superpowers/PHASE-7-ACCEPTANCE.md`
- Modify: `docs/superpowers/ROADMAP.md`

- [ ] **Step 1: Run the full green gate**

Run (Rust): `cd glint/src-tauri && cargo build && cargo test`
Run (frontend): `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all green. Record the exact counts.

- [ ] **Step 2: Write the acceptance doc**

Create `docs/superpowers/PHASE-7-ACCEPTANCE.md`:

```markdown
# Phase 7 — "Pin to Screen" — Acceptance

**Status:** Built on `phase-7-pin-to-screen`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-24-glint-phase7-pin-to-screen-design.md
**Plan:** plans/2026-06-24-glint-phase7-pin-to-screen.md

## Automated (green gate)
- [ ] `cargo build` OK; `cargo test` green (incl. pin: next_label, insert/get/remove, forget, capped_size ×2).
- [ ] `tsc --noEmit` clean; `vitest run` green; `vite build` clean.

## At-screen (manual)
- [ ] Capture → HUD → **Pin** → a floating always-on-top image appears.
- [ ] Library → a capture's **Pin to screen** button → it pins.
- [ ] Drag the image to move it; it stays on top of other apps.
- [ ] Mouse-wheel over the pin scales it (aspect locked); corner handles resize it; both clamp (can't go below ~80px or past the screen).
- [ ] Right-click → Opacity 100/75/50/25 fades the image; → Copy (paste elsewhere); → Save to Library (appears in Library/Recent Captures); → Close.
- [ ] Hover **×** closes; **Esc** closes (after clicking the pin).
- [ ] Multiple pins at once, each independent; quitting Glint clears them all.
```

- [ ] **Step 3: Update ROADMAP**

In `docs/superpowers/ROADMAP.md`, move Phase 7 into `## Shipped` with a one-paragraph summary marked *Built — awaiting at-screen.*

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-7-ACCEPTANCE.md docs/superpowers/ROADMAP.md
git commit -m "docs(p7): acceptance checklist + roadmap"
```

---

## Self-Review notes (author)

- **Spec coverage:** registry/window-per-pin (T1/T2), entry points HUD+Library (T5), move/scroll-resize/handle-resize (T4 PinApp), opacity CSS (T4), copy/save/close commands (T2) + menu (T4), ephemeral + destroy cleanup (T1 `forget` + T3 `on_window_event`), cap-to-40%/cascade/clamps (T1 `capped_size` + T2 builder + T4 clamps), interactive non-focus-less window (T2 flags), no new deps, `/pin` route (T4). All covered.
- **Deliberate simplification (flag for acceptance):** the spec mentioned Library "right-click" in addition to a hover button; the existing Library cards have NO right-click menu (all actions are hover buttons), so this plan adds only the **hover Pin button** to match the established card pattern. A bespoke per-card context menu is not built. If a right-click affordance is wanted later it can be added uniformly to all card actions.
- **No clean unit-test seam** for the windowing/commands (Tauri runtime) or `PinApp` (Tauri window API + DOM) — those are verified by `cargo build`/`tsc`/`vite build` + the at-screen checklist. Only the pure registry/`capped_size` logic is unit-tested (T1).
- **Type consistency:** `PinData{png,width,height}`, `PinState::{next_label,insert,get,remove}`, `capped_size(u32,u32,f64,f64,f64)->(f64,f64)`, `forget(&PinState,&str)`, `PinDataDto{image_data_url,width,height}`, commands `pin_create_from_last|pin_create_from_capture(id)|pin_data|pin_save|pin_copy|pin_close`, wrappers `getPinData|pinCreateFromLast|pinCreateFromCapture|pinSave|pinCopy|pinClose` — consistent across tasks.
- **Risk note for execution:** T2 (windowing) and T4 (`PinApp` interactions) are the higher-risk tasks; T1 is pure/tested; T3/T5 are mechanical glue; T6 verification.
