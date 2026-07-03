# Quick Access Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single post-capture HUD into an accumulating bottom-left tray — a vertical stack (cap 5) of recent captures, each independently actionable (Copy, Copy-path, Save/Reveal, Annotate, Extract-text, Pin, Drag, Delete) plus Clear all.

**Architecture:** A new pure `TrayStore` (unit-tested) is the source of truth; `LastCapture` stays as the newest-mirror for existing "…_from_last" hotkeys. Per-id `tray_*` commands reuse path-based cores extracted from the existing id-commands. The existing `hud` window evolves in place — persistent, self-resizing, bottom-left-anchored — rather than a new window. Frontend `HudApp` becomes the stack renderer.

**Tech Stack:** Rust, Tauri v2 (`windows` crate not involved here), `image` crate, React 19, TypeScript, Vitest, Cargo tests.

## Global Constraints

- **Local-first:** no cloud, no upload, no accounts, no network calls. URL/paths are local only.
- **Single-user:** no auth of any kind.
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*` import nothing from `capture/`/`editor/`/`overlay/`/`ocr/`; `ocr/` imports nothing from `recorder/`. This phase touches `capture`/`editor`/`hud`/`pin`/`ocr` (already coupled) — never `recorder`. The green gate re-verifies with greps.
- **Tauri IPC casing:** JS `invoke` arg keys are **camelCase**, mapped to snake_case Rust params (multi-word snake_case JS keys silently arrive as `None`). Single-word params (`id`, `height`) are safe.
- **Window rules:** build webviews off the main thread; window-targeted events use `emit_to` (never global `emit`); a capability edit needs a forced recompile.
- **Base branch:** work on `phase-14-quick-access-overlay`, merge to `master`.
- **Tray cap = 5; newest at bottom; in-memory (cleared on quit); deleting/evicting removes the temp file only when `!saved` (never a Library file).**

---

### Task 1: `TrayStore` — the pure tray model

**Files:**
- Create: `glint/src-tauri/src/capture/tray.rs`
- Modify: `glint/src-tauri/src/capture/mod.rs` (add `pub mod tray;` + re-export)
- Modify: `glint/src-tauri/src/lib.rs:108` (add `.manage(...)`)

**Interfaces:**
- Produces:
  - `struct TrayItem { id: u64, path: String, width: u32, height: u32, saved: bool, thumb: String }` (derives `Clone, Serialize`)
  - `struct TrayStore` with `push(&mut self, path: String, width: u32, height: u32, saved: bool, thumb: String) -> (u64, Option<TrayItem>)`, `list(&self) -> Vec<TrayItem>`, `get(&self, id: u64) -> Option<TrayItem>`, `remove(&mut self, id: u64) -> Option<TrayItem>`, `mark_saved(&mut self, id: u64, path: String)`, `clear(&mut self) -> Vec<TrayItem>`, `is_empty(&self) -> bool`
  - `struct TrayState(pub Mutex<TrayStore>)` (derives `Default`)
  - `const TRAY_CAP: usize = 5`

- [ ] **Step 1: Write the failing tests**

Create `glint/src-tauri/src/capture/tray.rs` with the test module first (types come in Step 3):

```rust
//! The Quick Access Overlay's model: an accumulating, capped stack of recent
//! captures. Pure (no Tauri types) so its logic is unit-tested in isolation.

use serde::Serialize;
use std::sync::Mutex;

pub const TRAY_CAP: usize = 5;

#[derive(Clone, Serialize)]
pub struct TrayItem {
    pub id: u64,
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub saved: bool,
    pub thumb: String,
}

#[derive(Default)]
pub struct TrayStore {
    items: Vec<TrayItem>, // newest last
    next_id: u64,
}

#[derive(Default)]
pub struct TrayState(pub Mutex<TrayStore>);

#[cfg(test)]
mod tests {
    use super::*;

    fn push(store: &mut TrayStore, tag: &str, saved: bool) -> u64 {
        store.push(format!("/tmp/{tag}.png"), 10, 10, saved, "data:thumb".into()).0
    }

    #[test]
    fn push_assigns_increasing_ids_newest_last() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", false);
        let b = push(&mut s, "b", false);
        assert!(b > a);
        let ids: Vec<u64> = s.list().iter().map(|i| i.id).collect();
        assert_eq!(ids, vec![a, b]); // newest last
    }

    #[test]
    fn exceeding_cap_evicts_oldest_and_returns_it() {
        let mut s = TrayStore::default();
        let mut ids = vec![];
        for n in 0..TRAY_CAP {
            ids.push(push(&mut s, &format!("i{n}"), false));
        }
        let (_new, evicted) = s.push("/tmp/over.png".into(), 1, 1, false, "t".into());
        let evicted = evicted.expect("6th push evicts the oldest");
        assert_eq!(evicted.id, ids[0]);
        assert_eq!(s.list().len(), TRAY_CAP);
        assert!(s.get(ids[0]).is_none());
    }

    #[test]
    fn remove_returns_the_item_or_none() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", true);
        assert_eq!(s.remove(a).unwrap().saved, true);
        assert!(s.remove(a).is_none());
        assert!(s.remove(999).is_none());
    }

    #[test]
    fn mark_saved_flips_flag_and_path() {
        let mut s = TrayStore::default();
        let a = push(&mut s, "a", false);
        s.mark_saved(a, "/pics/a.png".into());
        let it = s.get(a).unwrap();
        assert!(it.saved);
        assert_eq!(it.path, "/pics/a.png");
    }

    #[test]
    fn clear_empties_and_returns_all() {
        let mut s = TrayStore::default();
        push(&mut s, "a", false);
        push(&mut s, "b", false);
        let removed = s.clear();
        assert_eq!(removed.len(), 2);
        assert!(s.is_empty());
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd glint/src-tauri && cargo test tray::`
Expected: FAIL to compile — `TrayStore` has no method `push`/`list`/etc.

- [ ] **Step 3: Implement `TrayStore`**

Add the `impl` block above the `#[cfg(test)]` module in `tray.rs`:

```rust
impl TrayStore {
    /// Append a new item (assigns its id). Returns `(new_id, evicted_oldest)` —
    /// `evicted` is `Some` when the push exceeded `TRAY_CAP`, so the caller can
    /// clean up its temp file.
    pub fn push(
        &mut self,
        path: String,
        width: u32,
        height: u32,
        saved: bool,
        thumb: String,
    ) -> (u64, Option<TrayItem>) {
        let id = self.next_id;
        self.next_id += 1;
        self.items.push(TrayItem { id, path, width, height, saved, thumb });
        let evicted = if self.items.len() > TRAY_CAP {
            Some(self.items.remove(0))
        } else {
            None
        };
        (id, evicted)
    }

    /// All items, newest last (the UI renders them bottom-anchored).
    pub fn list(&self) -> Vec<TrayItem> {
        self.items.clone()
    }

    pub fn get(&self, id: u64) -> Option<TrayItem> {
        self.items.iter().find(|i| i.id == id).cloned()
    }

    /// Remove an item by id, returning it (for temp-file cleanup) if present.
    pub fn remove(&mut self, id: u64) -> Option<TrayItem> {
        let idx = self.items.iter().position(|i| i.id == id)?;
        Some(self.items.remove(idx))
    }

    /// Flip an item to "saved" and repoint it at the durable file (Save action).
    pub fn mark_saved(&mut self, id: u64, path: String) {
        if let Some(it) = self.items.iter_mut().find(|i| i.id == id) {
            it.saved = true;
            it.path = path;
        }
    }

    /// Empty the tray, returning every item (for temp-file cleanup).
    pub fn clear(&mut self) -> Vec<TrayItem> {
        std::mem::take(&mut self.items)
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd glint/src-tauri && cargo test tray::`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire the module + managed state**

In `glint/src-tauri/src/capture/mod.rs`, add near the other `mod` lines:

```rust
pub mod tray;
```

In `glint/src-tauri/src/lib.rs`, after line 108 (`.manage(crate::capture::LastCaptureState::default())`):

```rust
        .manage(crate::capture::tray::TrayState::default())
```

- [ ] **Step 6: Build to confirm everything compiles**

Run: `cd glint/src-tauri && cargo build`
Expected: builds (dead-code warnings for not-yet-used methods are fine).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/capture/tray.rs glint/src-tauri/src/capture/mod.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p14): TrayStore — accumulating capped capture stack (pure, tested)"
```

---

### Task 2: Path-based cores for editor / pin / ocr (DRY refactor)

**Files:**
- Modify: `glint/src-tauri/src/editor/commands.rs` (extract `set_source_and_open`)
- Modify: `glint/src-tauri/src/pin.rs` (extract `pin_from_png_bytes`)
- Modify: `glint/src-tauri/src/ocr/commands.rs` (extract `ocr_recognize_path`)

**Interfaces:**
- Produces:
  - editor: `pub fn set_source_and_open(app: &AppHandle, ed: &EditorState, png: Vec<u8>, width: u32, height: u32, origin: &str, capture_id: Option<i64>)`
  - pin: `pub fn pin_from_png_bytes(app: &AppHandle, pins: &PinState, png: Vec<u8>, width: u32, height: u32) -> Result<(), String>`
  - ocr: `pub fn ocr_recognize_path(app: &tauri::AppHandle, path: &str) -> Result<(), String>`
- These are consumed by Task 3's `tray_*` commands and by the existing id/last commands (refactored here — no behavior change).

- [ ] **Step 1: Extract the editor core**

In `glint/src-tauri/src/editor/commands.rs`, add this helper (near `open_editor_window`):

```rust
/// Set the editor source to a PNG and open/raise the editor window. Shared by the
/// from-last, from-Library, and tray-annotate paths.
pub fn set_source_and_open(
    app: &AppHandle,
    ed: &EditorState,
    png: Vec<u8>,
    width: u32,
    height: u32,
    origin: &str,
    capture_id: Option<i64>,
) {
    *ed.0.lock().unwrap() = Some(EditorSource {
        png,
        width,
        height,
        origin: origin.into(),
        capture_id,
        doc: None,
        project_path: None,
    });
    open_editor_window(app);
}
```

Refactor `editor_open_from_last` to use it (keeps its HUD teardown):

```rust
pub fn editor_open_from_last(
    app: AppHandle,
    last: State<crate::capture::LastCaptureState>,
    ed: State<EditorState>,
) -> Result<(), String> {
    let (png, width, height) = {
        let guard = last.0.lock().unwrap();
        let l = guard.as_ref().ok_or("no capture result")?;
        let img = crate::capture::frozen::CapturedImage {
            width: l.width,
            height: l.height,
            rgba: l.rgba.clone(),
        };
        let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
        (png, l.width, l.height)
    };
    crate::hud::teardown(&app);
    set_source_and_open(&app, &ed, png, width, height, "hud", None);
    Ok(())
}
```

Refactor `editor_open_capture`'s tail (from `*ed.0.lock()…` through `open_editor_window(&app);`) to:

```rust
    set_source_and_open(&app, &ed, bytes, width, height, "library", Some(id));
    Ok(())
```

- [ ] **Step 2: Extract the pin core**

In `glint/src-tauri/src/pin.rs`, add:

```rust
/// Insert a pin from PNG bytes and build its window. Shared by from-last,
/// from-Library, and tray-pin. `(async)` callers keep this off the main thread.
pub fn pin_from_png_bytes(
    app: &AppHandle,
    pins: &PinState,
    png: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let label = pins.next_label();
    pins.insert(label.clone(), PinData { png, width, height });
    build_pin_window(app, &label, width, height).map_err(|e| e.to_string())
}
```

Refactor `pin_create_from_last`'s tail (the `let label = …` block) to:

```rust
    pin_from_png_bytes(&app, &pins, png, width, height)
```

Refactor `pin_create_from_capture`'s tail (from `let img = …` through the final `build_pin_window(…)`) to use the file bytes directly (already PNG):

```rust
    pin_from_png_bytes(&app, &pins, bytes, width, height)
```

- [ ] **Step 3: Extract the ocr core**

In `glint/src-tauri/src/ocr/commands.rs`, add:

```rust
/// Decode a PNG at `path`, OCR it, and open the panel. Shared by the from-Library
/// and tray extract-text paths. Not async itself (callers are async/spawned).
pub fn ocr_recognize_path(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|_| "Couldn't open that capture".to_string())?;
    let img = image::load_from_memory(&bytes)
        .map_err(|_| "Couldn't open that capture".to_string())?
        .to_rgba8();
    let (w, h) = (img.width(), img.height());
    let out = super::recognize(&img.into_raw(), w, h)?;
    publish_and_open(app, out);
    Ok(())
}
```

Refactor `ocr_extract_capture`'s tail (from `let bytes = …` through `Ok(())`) to:

```rust
    ocr_recognize_path(&app, &path)
```

- [ ] **Step 4: Build + run the full Rust suite (no behavior change)**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: builds; all existing tests still pass (this is a pure refactor).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/editor/commands.rs glint/src-tauri/src/pin.rs glint/src-tauri/src/ocr/commands.rs
git commit -m "refactor(p14): path-based cores for editor/pin/ocr (shared with tray)"
```

---

### Task 3: `tray_*` commands + remove the single-item `hud_*` commands

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs` (add `tray_*`; delete `hud_data/hud_copy/hud_copy_path/hud_save/hud_reveal/hud_dismiss`)
- Modify: `glint/src-tauri/src/hud.rs` (make `HUD_LABEL`/`HUD_W`/`MARGIN_X`/`MARGIN_Y` usable; add `ensure_open` in Task 4 — here just expose consts)
- Modify: `glint/src-tauri/src/lib.rs` (swap handler registrations)
- Modify: `glint/src-tauri/capabilities/hud.json` (window perms)

**Interfaces:**
- Consumes: `TrayState`/`TrayItem` (Task 1); `set_source_and_open`, `pin_from_png_bytes`, `ocr_recognize_path` (Task 2); `crate::hud::{HUD_LABEL, HUD_W, MARGIN_X, MARGIN_Y}`.
- Produces (registered commands): `tray_list`, `tray_copy`, `tray_copy_path`, `tray_save`, `tray_reveal`, `tray_pin`, `tray_annotate`, `tray_extract_text`, `tray_dismiss`, `tray_clear`, `tray_resize`.

- [ ] **Step 1: Expose the HUD window constants**

In `glint/src-tauri/src/hud.rs`, change the four consts to `pub`:

```rust
pub const HUD_LABEL: &str = "hud";
pub const HUD_W: f64 = 244.0;
pub const HUD_H: f64 = 172.0;
pub const MARGIN_X: f64 = 20.0;
pub const MARGIN_Y: f64 = 48.0;
```

- [ ] **Step 2: Delete the six single-item `hud_*` commands**

In `glint/src-tauri/src/capture/commands.rs`, delete the whole `// ─── HUD commands ───` section's command fns: `hud_data`, `hud_reveal`, `hud_copy`, `hud_copy_path`, `hud_save`, `hud_dismiss` (and the `HudData` struct). Note: `write_thumb` (line ~321) and `reveal_in_explorer` (line ~541) live **outside** this block and are untouched — the new tray commands reuse both.

- [ ] **Step 3: Add the tray commands**

Add a new section to `glint/src-tauri/src/capture/commands.rs`:

```rust
// ─── Tray (Quick Access Overlay) commands ─────────────────────────────────────
use crate::capture::tray::{TrayItem, TrayState};

/// Decode a PNG file to RGBA (for clipboard/OCR/pin actions on a tray item).
fn read_rgba(path: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (w, h) = (img.width(), img.height());
    Ok((img.into_raw(), w, h))
}

fn tray_item(state: &TrayState, id: u64) -> Result<TrayItem, String> {
    state.0.lock().unwrap().get(id).ok_or_else(|| "no such capture".to_string())
}

#[tauri::command]
pub fn tray_list(state: State<TrayState>) -> Vec<TrayItem> {
    state.0.lock().unwrap().list()
}

#[tauri::command]
pub fn tray_copy(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let (rgba, w, h) = read_rgba(&it.path)?;
    clipboard::copy_image(&rgba, w, h)
}

#[tauri::command]
pub fn tray_copy_path(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    clipboard::copy_text(&it.path)
}

#[tauri::command]
pub fn tray_reveal(state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    reveal_in_explorer(&it.path)
}

/// Save a tray item into the Library (no-op returning its path if already saved).
#[tauri::command]
pub fn tray_save(app: AppHandle, state: State<TrayState>, id: u64) -> Result<String, String> {
    let it = tray_item(&state, id)?;
    if it.saved {
        return Ok(it.path);
    }
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let filename = crate::paths::capture_filename(chrono::Local::now());
    let dest = crate::paths::dedupe(&dir, &filename, |p| p.exists());
    std::fs::copy(&it.path, &dest).map_err(|e| e.to_string())?;
    let dest_str = dest.to_string_lossy().to_string();

    // Curate into the Library: thumbnail + DB row + event (mirrors the old hud_save).
    let (rgba, w, h) = read_rgba(&dest_str)?;
    let thumb_path = write_thumb(&app, &rgba, w, h, &dest_str);
    let bytes = std::fs::metadata(&dest).map(|m| m.len() as i64).ok();
    let row = crate::db::NewCapture {
        kind: "screenshot".into(),
        path: dest_str.clone(),
        thumb_path,
        width: Some(w as i64),
        height: Some(h as i64),
        bytes,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    };
    {
        let conn = app.state::<crate::Db>();
        let guard = conn.0.lock().unwrap();
        if let Err(e) = crate::db::insert_capture(&guard, &row) {
            log::error!("tray_save insert_capture failed: {e}");
        }
    }
    let _ = app.emit("capture-saved", ());
    state.0.lock().unwrap().mark_saved(id, dest_str.clone());
    Ok(dest_str)
}

#[tauri::command(async)]
pub fn tray_annotate(
    app: AppHandle,
    state: State<TrayState>,
    ed: State<crate::editor::EditorState>,
    id: u64,
) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let png = std::fs::read(&it.path).map_err(|e| e.to_string())?;
    crate::editor::commands::set_source_and_open(&app, &ed, png, it.width, it.height, "hud", None);
    Ok(())
}

#[tauri::command(async)]
pub fn tray_pin(
    app: AppHandle,
    state: State<TrayState>,
    pins: State<crate::pin::PinState>,
    id: u64,
) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    let png = std::fs::read(&it.path).map_err(|e| e.to_string())?;
    crate::pin::pin_from_png_bytes(&app, &pins, png, it.width, it.height)
}

#[tauri::command(async)]
pub fn tray_extract_text(app: AppHandle, state: State<TrayState>, id: u64) -> Result<(), String> {
    let it = tray_item(&state, id)?;
    crate::ocr::commands::ocr_recognize_path(&app, &it.path)
}

/// Remove one card; delete its temp file (never a saved Library file); close the
/// window when the tray goes empty.
#[tauri::command]
pub fn tray_dismiss(app: AppHandle, state: State<TrayState>, id: u64) -> Result<(), String> {
    let (removed, empty) = {
        let mut store = state.0.lock().unwrap();
        let removed = store.remove(id);
        (removed, store.is_empty())
    };
    if let Some(it) = removed {
        if !it.saved {
            let _ = std::fs::remove_file(&it.path);
        }
    }
    if empty {
        crate::hud::teardown(&app);
    }
    Ok(())
}

/// Empty the whole tray, delete every temp file, close the window.
#[tauri::command]
pub fn tray_clear(app: AppHandle, state: State<TrayState>) -> Result<(), String> {
    let removed = state.0.lock().unwrap().clear();
    for it in removed {
        if !it.saved {
            let _ = std::fs::remove_file(&it.path);
        }
    }
    crate::hud::teardown(&app);
    Ok(())
}

/// Resize + reposition the tray window to a new logical height, bottom-left-anchored
/// (fixed width). Called by the frontend as the stack grows/shrinks.
#[tauri::command]
pub fn tray_resize(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(crate::hud::HUD_LABEL) {
        let _ = win.set_size(tauri::LogicalSize::new(crate::hud::HUD_W, height));
        if let Ok(Some(monitor)) = win.primary_monitor() {
            let scale = monitor.scale_factor();
            let pos = monitor.position();
            let size = monitor.size();
            let h_phys = (height * scale) as i32;
            let margin_x = (crate::hud::MARGIN_X * scale) as i32;
            let margin_y = (crate::hud::MARGIN_Y * scale) as i32;
            let x = pos.x + margin_x;
            let y = pos.y + size.height as i32 - h_phys - margin_y;
            let _ = win.set_position(tauri::PhysicalPosition { x, y });
        }
    }
    Ok(())
}
```

- [ ] **Step 4: Swap the command registrations**

In `glint/src-tauri/src/lib.rs`, update the `use crate::capture::commands::{…}` import at **lines 19–20**: remove `hud_copy, hud_copy_path, hud_data, hud_dismiss, hud_reveal, hud_save` and add the eleven `tray_*` names. Then in `invoke_handler` remove the six lines `hud_data, hud_copy, hud_copy_path, hud_save, hud_dismiss, hud_reveal` and add:

```rust
            tray_list,
            tray_copy,
            tray_copy_path,
            tray_save,
            tray_reveal,
            tray_pin,
            tray_annotate,
            tray_extract_text,
            tray_dismiss,
            tray_clear,
            tray_resize,
```

Ensure the `use` glob that brought `hud_*` into scope now brings the `tray_*` names (they're in the same `capture::commands` module, so the existing `use crate::capture::commands::{…}` import list must be updated: drop the deleted names, add the new ones).

- [ ] **Step 5: Grant the tray window resize perms**

Replace `glint/src-tauri/capabilities/hud.json` with:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "hud",
  "description": "Capability for the persistent post-capture tray window",
  "windows": ["hud"],
  "permissions": [
    "core:default",
    "drag:default",
    "core:window:allow-set-size",
    "core:window:allow-set-position"
  ]
}
```

- [ ] **Step 6: Build (forced recompile for the capability edit)**

Run: `cd glint/src-tauri && cargo build`
Expected: builds. (A capability change requires a full recompile — `cargo build` does this.)

- [ ] **Step 7: Run the Rust suite**

Run: `cd glint/src-tauri && cargo test`
Expected: PASS (TrayStore tests + all existing).

- [ ] **Step 8: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/hud.rs glint/src-tauri/src/lib.rs glint/src-tauri/capabilities/hud.json
git commit -m "feat(p14): per-id tray_* commands; drop single-item hud_* commands"
```

---

### Task 4: Accumulate on capture + evolve the window to persistent/resizable

**Files:**
- Modify: `glint/src-tauri/src/hud.rs` (`open` → `ensure_open`; emit on update)
- Modify: `glint/src-tauri/src/capture/mod.rs` (drop per-capture `hud::teardown` in `begin_restoring`)
- Modify: `glint/src-tauri/src/capture/commands.rs` (`finish_commit`: build thumb, push, cleanup evicted, `ensure_open`)
- Modify: `glint/src-tauri/src/editor/commands.rs` (`editor_done`: push tray card + `ensure_open`)

**Interfaces:**
- Consumes: `TrayState` (Task 1); `crate::capture::thumb::make_thumb`.
- Produces: `pub fn ensure_open(app: &AppHandle) -> tauri::Result<()>` (replaces `open`).

- [ ] **Step 1: Rewrite the window opener as `ensure_open`**

In `glint/src-tauri/src/hud.rs`, add `use tauri::Emitter;` to the imports, and replace `pub fn open(app: &AppHandle) -> tauri::Result<()> { … }` with:

```rust
/// Ensure the persistent tray window exists. If it's already open, notify it to
/// refetch (a new capture just landed). Otherwise build it (off the main thread —
/// callers already run on a background thread). It is NOT torn down per capture;
/// it persists and stays continuously visible (a hidden/re-shown focus-less
/// transparent WebView2 gets its renderer suspended — see the module note).
pub fn ensure_open(app: &AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(HUD_LABEL).is_some() {
        let _ = app.emit_to(HUD_LABEL, "tray-updated", ());
        return Ok(());
    }

    let url = WebviewUrl::App("index.html#/hud".into());
    let win = WebviewWindowBuilder::new(app, HUD_LABEL, url)
        .title("Glint")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .inner_size(HUD_W, HUD_H) // initial; the frontend resizes to its content
        .visible(false)
        .build()?;

    if let Some(monitor) = win.primary_monitor()? {
        let scale = monitor.scale_factor();
        let pos = monitor.position();
        let size = monitor.size();
        let hud_h = (HUD_H * scale) as i32;
        let margin_x = (MARGIN_X * scale) as i32;
        let margin_y = (MARGIN_Y * scale) as i32;
        let x = pos.x + margin_x;
        let y = pos.y + size.height as i32 - hud_h - margin_y;
        win.set_position(tauri::PhysicalPosition { x, y })?;
    } else {
        log::warn!("tray: no primary monitor; using default window position");
    }

    win.show()?;
    Ok(())
}
```

Keep `teardown` exactly as-is.

- [ ] **Step 2: Stop tearing the tray down on every capture**

In `glint/src-tauri/src/capture/mod.rs`, in `begin_restoring`, delete the line:

```rust
    crate::hud::teardown(app);
```

(Leave `overlay::teardown_all(app);` right above it. Update the adjacent comment so it no longer claims the HUD is closed per capture.)

- [ ] **Step 3: Push into the tray in `finish_commit`**

In `glint/src-tauri/src/capture/commands.rs`, inside `finish_commit`, right after the block that sets `LastCaptureState` (the `*app.state::<crate::capture::LastCaptureState>()…` assignment), add:

```rust
    // Also push into the accumulating tray. Build the small card thumbnail once
    // (full pixels are re-read from disk when an action needs them). Evicting the
    // oldest past the cap deletes its temp file (never a saved Library file).
    {
        let thumb = crate::capture::thumb::make_thumb(&cropped, clamped.w, clamped.h, 240)
            .ok()
            .map(|png| {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                format!("data:image/png;base64,{b64}")
            })
            .unwrap_or_default();
        let evicted = {
            let tray = app.state::<crate::capture::tray::TrayState>();
            let mut store = tray.0.lock().unwrap();
            let (_id, evicted) = store.push(path_str.clone(), clamped.w, clamped.h, saved, thumb);
            evicted
        };
        if let Some(ev) = evicted {
            if !ev.saved {
                let _ = std::fs::remove_file(&ev.path);
            }
        }
    }
```

- [ ] **Step 4: Point the commit at `ensure_open`**

In the same function, in the `else` branch that opens the HUD, change `crate::hud::open(app)` to `crate::hud::ensure_open(app)` (the `let hud_result = …` line and its log text). The error-fallback `emit("capture-complete", …)` stays.

- [ ] **Step 5: Update `editor_done` (the second `hud::open` caller)**

`editor_done` (`glint/src-tauri/src/editor/commands.rs`) also opens the HUD and must
(a) switch to `ensure_open` and (b) push its flattened result as a tray card so the
annotated image shows up in the tray too. Rewrite the body from
`let img = image::load_from_memory…` through the `std::thread::spawn(move || match …)`
opening line as follows (the rest of the closure — the `main` hide + error toast —
is unchanged except `open`→`ensure_open`):

```rust
    let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
    let (width, height) = (img.width(), img.height());
    let rgba = img.into_raw();

    // Temp PNG so drag-out / copy-path / reveal have a real file. Not yet in the
    // Library (saved=false) → the card shows Save, not Reveal.
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let dest = dir.join(format!("glint-edit-{ts}.png"));
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let path = dest.to_string_lossy().to_string();

    // Push into the tray (build the card thumb first), then mirror to LastCapture.
    {
        let thumb = crate::capture::thumb::make_thumb(&rgba, width, height, 240)
            .ok()
            .map(|png| {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
                format!("data:image/png;base64,{b64}")
            })
            .unwrap_or_default();
        let evicted = {
            let tray = app.state::<crate::capture::tray::TrayState>();
            let mut store = tray.0.lock().unwrap();
            store.push(path.clone(), width, height, false, thumb).1
        };
        if let Some(ev) = evicted {
            if !ev.saved {
                let _ = std::fs::remove_file(&ev.path);
            }
        }
    }

    *last.0.lock().unwrap() = Some(crate::capture::LastCapture {
        path,
        width,
        height,
        rgba,
        saved: false,
    });

    let app2 = app.clone();
    std::thread::spawn(move || match crate::hud::ensure_open(&app2) {
```

(`base64::engine::…encode` and `app.state`/`app.path` are already in scope in this
file.)

- [ ] **Step 6: Build + test**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: builds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/hud.rs glint/src-tauri/src/capture/mod.rs glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/editor/commands.rs
git commit -m "feat(p14): accumulate captures into a persistent, resizable tray window"
```

---

### Task 5: Frontend — the stacking tray UI

**Files:**
- Rewrite: `glint/src/lib/hudIpc.ts` (tray wrappers + `TrayItem`)
- Create: `glint/src/hud/TrayCard.tsx`
- Rewrite: `glint/src/hud/HudApp.tsx` (renders the stack; keeps its export name so the route import is unchanged)
- Modify: `glint/src/hud/hud.css` (stack layout + Clear all)
- Reuse: `glint/src/hud/HudActions.tsx` (unchanged)

**Interfaces:**
- Consumes: `tray_list`, `tray_copy`, `tray_copy_path`, `tray_save`, `tray_reveal`, `tray_pin`, `tray_annotate`, `tray_extract_text`, `tray_dismiss`, `tray_clear`, `tray_resize` (Task 3); the `tray-updated` event (Task 4).

- [ ] **Step 1: Rewrite `hudIpc.ts`**

Replace `glint/src/lib/hudIpc.ts` with:

```ts
/**
 * hudIpc.ts — typed wrappers for the Quick Access Overlay (the accumulating
 * post-capture tray, route #/hud). All invoke() arg keys are camelCase.
 * Local-first: no network. Drag-out reuses the proven tauri-plugin-drag path.
 */
import { invoke } from "@tauri-apps/api/core";
import { startDrag } from "@crabnebula/tauri-plugin-drag";

export type TrayItem = {
  id: number;
  /** Absolute path to the capture file (drag / copy-path / reveal source). */
  path: string;
  width: number;
  height: number;
  /** True when saved to the Library — the card shows Reveal instead of Save. */
  saved: boolean;
  /** Small base64 PNG data URL for the card thumbnail. */
  thumb: string;
};

export const trayList = (): Promise<TrayItem[]> => invoke<TrayItem[]>("tray_list");
export const trayCopy = (id: number): Promise<void> => invoke<void>("tray_copy", { id });
export const trayCopyPath = (id: number): Promise<void> => invoke<void>("tray_copy_path", { id });
export const traySave = (id: number): Promise<string> => invoke<string>("tray_save", { id });
export const trayReveal = (id: number): Promise<void> => invoke<void>("tray_reveal", { id });
export const trayPin = (id: number): Promise<void> => invoke<void>("tray_pin", { id });
export const trayAnnotate = (id: number): Promise<void> => invoke<void>("tray_annotate", { id });
export const trayExtractText = (id: number): Promise<void> => invoke<void>("tray_extract_text", { id });
export const trayDismiss = (id: number): Promise<void> => invoke<void>("tray_dismiss", { id });
export const trayClear = (): Promise<void> => invoke<void>("tray_clear");
export const trayResize = (height: number): Promise<void> => invoke<void>("tray_resize", { height });

// A 1×1 transparent PNG drag icon so dragging shows only the OS cursor — not a big
// image ghost. Pre-fetched at module load because the OS drag must start
// synchronously inside the pointerdown gesture.
let blankDragIcon: string | null = null;
void invoke<string>("drag_blank_icon").then((p) => { blankDragIcon = p; }).catch(() => {});

/** Drag the real file out into any app (blank drag icon → just the cursor). */
export function dragOut(path: string): void {
  void startDrag({ item: [path], icon: blankDragIcon ?? path, mode: "copy" });
}
```

- [ ] **Step 2: Create `TrayCard.tsx`**

Create `glint/src/hud/TrayCard.tsx`:

```tsx
/**
 * TrayCard.tsx — one capture card in the Quick Access Overlay stack. Mirrors the
 * old single-HUD card: a drag-handle thumbnail, viewfinder ticks, dimensions, a
 * corner Delete, the hover action toolbar, and its own inline status line. Actions
 * target this card's id.
 */
import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { HudActions, type HudAction } from "./HudActions";
import {
  type TrayItem,
  trayCopy,
  trayCopyPath,
  traySave,
  trayReveal,
  trayPin,
  trayAnnotate,
  trayExtractText,
  trayDismiss,
  dragOut,
} from "../lib/hudIpc";

export function TrayCard({ item, onChanged }: { item: TrayItem; onChanged: () => void }) {
  const [saved, setSaved] = useState(item.saved);
  const [status, setStatus] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus(null), 1900);
  }, []);

  const onAction = useCallback(
    async (a: HudAction) => {
      try {
        switch (a) {
          case "copy": await trayCopy(item.id); flash("Copied to clipboard"); break;
          case "copy-path": await trayCopyPath(item.id); flash("Path copied"); break;
          case "save":
            if (saved) { await trayReveal(item.id); flash("Revealed in folder"); }
            else { await traySave(item.id); setSaved(true); flash("Saved to Library"); }
            break;
          case "annotate": await trayAnnotate(item.id); break;
          case "extract-text": await trayExtractText(item.id); flash("Text extracted"); break;
          case "pin": await trayPin(item.id); flash("Pinned"); break;
          case "dismiss": await trayDismiss(item.id); onChanged(); break;
        }
      } catch {
        flash("Something went wrong");
      }
    },
    [item.id, saved, flash, onChanged],
  );

  return (
    <div className="hud-card">
      <div
        className="hud-drag"
        onPointerDown={() => dragOut(item.path)}
        role="img"
        aria-label="Captured image — drag to share"
        title="Drag to share"
      >
        <img className="hud-thumb-img" src={item.thumb} alt="" draggable={false} />
      </div>

      <span className="hud-tick hud-tick--tl" />
      <span className="hud-tick hud-tick--tr" />
      <span className="hud-tick hud-tick--bl" />
      <span className="hud-tick hud-tick--br" />

      <span className="hud-dims">
        {item.width}<span className="hud-dims-x">×</span>{item.height}
      </span>

      <button
        type="button"
        className="hud-close"
        aria-label="Dismiss"
        title="Dismiss"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onAction("dismiss")}
      >
        <X size={13} strokeWidth={2} />
      </button>

      <div className="hud-scrim" aria-hidden="true" />
      <HudActions onAction={onAction} saved={saved} />

      <div className={`hud-status${status ? " hud-status--show" : ""}`} aria-live="polite">
        {status}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `HudApp.tsx` as the stack**

Replace `glint/src/hud/HudApp.tsx` with:

```tsx
/**
 * HudApp.tsx — root of the Quick Access Overlay (route #/hud). An accumulating
 * bottom-left stack of recent captures (newest at the bottom). Refetches on the
 * `tray-updated` event, and resizes its own window to the stack's height.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { trayList, trayClear, trayResize, type TrayItem } from "../lib/hudIpc";
import { TrayCard } from "./TrayCard";
import "./hud.css";

export function HudApp() {
  const [items, setItems] = useState<TrayItem[]>([]);
  const stackRef = useRef<HTMLDivElement>(null);

  const refetch = useCallback(() => {
    trayList().then(setItems).catch(() => setItems([]));
  }, []);

  // Initial load + refetch whenever a new capture lands.
  useEffect(() => {
    refetch();
    const p = listen("tray-updated", refetch);
    return () => { p.then((un) => un()); };
  }, [refetch]);

  // Esc clears the whole tray (mirrors the old HUD dismiss).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void trayClear(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Resize the window to fit the stack's rendered height (bottom-anchored in Rust).
  useEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0) void trayResize(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="tray-root" ref={stackRef}>
      {items.length >= 2 && (
        <button type="button" className="tray-clear" onClick={() => void trayClear()}>
          Clear all
        </button>
      )}
      <div className="tray-stack">
        {items.map((it) => (
          <TrayCard key={it.id} item={it} onChanged={refetch} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the stack layout CSS**

Append to `glint/src/hud/hud.css`:

```css
/* ── Quick Access Overlay: vertical stack of cards ─────────────────────────── */
.tray-root {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  padding: 6px;
}
.tray-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.tray-clear {
  align-self: flex-start;
  padding: 3px 10px;
  border: none;
  border-radius: 999px;
  background: rgba(20, 20, 22, 0.82);
  color: #f2f2f2;
  font-size: 11px;
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.tray-clear:hover { background: rgba(30, 30, 34, 0.92); }
```

- [ ] **Step 5: Typecheck + frontend tests**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all Vitest suites pass (no suite depends on the removed hud wrappers).

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/hudIpc.ts glint/src/hud/TrayCard.tsx glint/src/hud/HudApp.tsx glint/src/hud/hud.css
git commit -m "feat(p14): stacking Quick Access Overlay UI (per-card actions + self-resize)"
```

---

### Task 6: Green gate, at-screen acceptance & merge

**Files:** none (verification + merge).

- [ ] **Step 1: Frontend gate**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: clean; all suites pass.

- [ ] **Step 2: Backend gate**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: builds; all Rust tests pass (incl. `tray::` tests).

- [ ] **Step 3: Recorder/OCR isolation greps**

Run:
```bash
cd glint/src-tauri
grep -rnE "use +crate::(capture|editor|overlay|ocr)" src/recorder/ && echo VIOLATION || echo "recorder isolation OK"
grep -rnE "use +crate::recorder" src/ocr/ && echo VIOLATION || echo "ocr isolation OK"
```
Expected: both print "… OK".

- [ ] **Step 4: At-screen acceptance (with the user)**

Launch `npm run tauri dev`. Verify:
1. Take 3–4 captures in a row → cards **stack in the bottom-left, newest at the bottom**; the window grows upward and stays corner-anchored.
2. A 6th capture drops the oldest card off the top.
3. Per card, each action targets the right shot: **Copy**, **Copy-path**, **Save** (→ flips to Reveal), **Annotate** (opens the editor with that shot), **Extract text** (OCR panel), **Pin** (floats that shot), **Drag** (drops the file), **Delete** (×) removes just that card.
4. **Clear all** (shown at 2+ cards) empties the stack and closes the window; **Esc** does the same.
5. Dismissing the last card closes the window; a later capture reopens it.
6. `open_in_editor` capture mode still bypasses the tray straight into the editor.
7. Existing **Pin last** hotkey still works (LastCapture mirror intact).

- [ ] **Step 5: Merge to master**

After the user confirms:
```bash
cd "C:/Users/sanir/Claude Code/glint"
git checkout master
git merge --no-ff phase-14-quick-access-overlay -m "merge: Phase 14 — Quick Access Overlay (accumulating post-capture tray)"
git branch -d phase-14-quick-access-overlay
```

---

## Notes for the implementer

- **Run `npx`/`cargo`/`git` from the directory in each command.** Repo root is `C:\Users\sanir\Claude Code`; frontend in `glint/`, Rust in `glint/src-tauri/`.
- **Dev-server exe lock:** if `cargo build` can't write `glint.exe`, run `Stop-Process -Name glint -Force` first.
- **Never touch** `glint/src-tauri/src/recorder/` or `glint/src/recorder/`.
- **Do not remove** `LastCaptureState` or the `…_from_last` commands — the tray mirrors to `LastCapture` for the "pin last"-style hotkeys.
- Window-targeted messages use `emit_to("hud", …)`, never global `emit`.
