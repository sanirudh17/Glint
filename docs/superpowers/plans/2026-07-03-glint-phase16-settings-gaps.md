# Settings Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the low-risk "later phase" settings placeholders: custom capture folder, Launch at login, Sound effects, Show in taskbar, Include cursor — and fix the Storage panel's stale path display.

**Architecture:** A single `settings::locations::save_dir(app, kind)` resolver becomes the source of truth for where screenshots and recordings save, called from all four screenshot save sites and the recorder. Four new persisted `Settings` fields (`save_dir`, `sound_effects`, `show_in_taskbar`, `include_cursor`) plus a registry-truth Launch-at-login toggle. New Rust units: a WAV-synth shutter, a Win32 cursor compositor, and a `winreg` autostart helper — each small and isolated. Frontend rewrites the Storage panel (folder picker + real paths) and wires the General/Capture toggles.

**Tech Stack:** Rust, Tauri v2 (`tauri-plugin-dialog`), `winreg`, the `windows` crate (Win32 GDI + Media Audio), React 19 + TypeScript, Zustand, Cargo tests, Vitest, SQLite.

## Global Constraints

- **Local-first / single-user:** no cloud, accounts, auth, or network calls. All settings persist only to the local SQLite `settings` table (Launch-at-login lives in the registry).
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*` import nothing from `capture/`/`editor/`/`overlay/`/`ocr/`; `ocr/` imports nothing from `recorder/`. The recorder MAY import `crate::settings` (not a sacred module) to resolve the save dir. The green gate re-verifies with greps.
- **Tauri v2 IPC casing:** `invoke` arg keys are camelCase → snake_case Rust params. New command args are single-word (`path`, `on`) — safe.
- **Visible feedback:** every toggle/action gives immediate visible feedback (toast or inline state); never silent.
- **No new crates:** only enable additional `windows` crate features (`Win32_Graphics_Gdi`, `Win32_Media_Audio`). A Cargo feature change requires a full `cargo build` recompile.
- **No file migration:** changing the folder affects only new captures; existing Library rows keep their paths.
- **Base branch:** work on `phase-16-settings-gaps`, merge to `master`.

---

### Task 1: Settings fields + `save_dir` resolver core

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs` (4 fields + defaults + `apply_update` arms + `pub mod locations;`)
- Create: `glint/src-tauri/src/settings/locations.rs` (`SaveKind`, pure `resolve`, `save_dir`, tests)

**Interfaces:**
- Produces:
  - `Settings` gains `save_dir: String`, `sound_effects: bool`, `show_in_taskbar: bool`, `include_cursor: bool`.
  - `pub enum SaveKind { Screenshot, Recording }`
  - `pub fn resolve(save_dir: &str, default_root: std::path::PathBuf) -> std::path::PathBuf`
  - `pub fn save_dir(app: &tauri::AppHandle, kind: SaveKind) -> std::path::PathBuf`

- [ ] **Step 1: Add the fields + defaults**

In `glint/src-tauri/src/settings/mod.rs`, add to the `Settings` struct (after `record_cursor_size`):

```rust
    /// Custom folder for new captures (screenshots + recordings). Empty = platform defaults
    /// (`Pictures\Glint` / `Videos\Glint`).
    pub save_dir: String,
    /// Play a shutter click on screenshot capture.
    pub sound_effects: bool,
    /// Keep the main window's button in the Windows taskbar.
    pub show_in_taskbar: bool,
    /// Bake the mouse cursor into screenshots.
    pub include_cursor: bool,
```

And to `Default for Settings` (after `record_cursor_size: "off".into(),`):

```rust
            save_dir: String::new(),
            sound_effects: false,
            show_in_taskbar: true,
            include_cursor: false,
```

- [ ] **Step 2: Add `apply_update` arms**

In `apply_update`, immediately before the `other => return Err(...)` arm, add:

```rust
        "save_dir" => {
            s.save_dir = value.as_str().ok_or("save_dir must be string")?.to_string();
        }
        "sound_effects" => {
            s.sound_effects = value.as_bool().ok_or("sound_effects must be boolean")?;
        }
        "show_in_taskbar" => {
            s.show_in_taskbar = value.as_bool().ok_or("show_in_taskbar must be boolean")?;
        }
        "include_cursor" => {
            s.include_cursor = value.as_bool().ok_or("include_cursor must be boolean")?;
        }
```

- [ ] **Step 3: Write the resolver with failing tests**

Create `glint/src-tauri/src/settings/locations.rs`:

```rust
//! Resolves where new captures are written. The custom `save_dir` setting (when set) wins;
//! otherwise the platform default (`Pictures\Glint` for screenshots, `Videos\Glint` for
//! recordings). The pure `resolve` is unit-tested; `save_dir` wires in the AppHandle.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::commands::SettingsState;

#[derive(Clone, Copy)]
pub enum SaveKind {
    Screenshot,
    Recording,
}

/// Pure core: the custom dir when non-empty (trimmed), else `default_root`.
pub fn resolve(save_dir: &str, default_root: PathBuf) -> PathBuf {
    let trimmed = save_dir.trim();
    if trimmed.is_empty() {
        default_root
    } else {
        PathBuf::from(trimmed)
    }
}

/// The directory new captures of `kind` should be written to. Reads `SettingsState`.
pub fn save_dir(app: &AppHandle, kind: SaveKind) -> PathBuf {
    let custom = app.state::<SettingsState>().0.lock().unwrap().save_dir.clone();
    let default_root = match kind {
        SaveKind::Screenshot => app
            .path()
            .picture_dir()
            .map(|p| p.join("Glint"))
            .unwrap_or_else(|_| PathBuf::from("Glint")),
        SaveKind::Recording => app
            .path()
            .video_dir()
            .map(|p| p.join("Glint"))
            .unwrap_or_else(|_| PathBuf::from("Glint")),
    };
    resolve(&custom, default_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_save_dir_uses_default_root() {
        let def = PathBuf::from("C:/Users/x/Pictures/Glint");
        assert_eq!(resolve("", def.clone()), def);
        assert_eq!(resolve("   ", def.clone()), def);
    }

    #[test]
    fn set_save_dir_overrides_default() {
        let def = PathBuf::from("C:/Users/x/Pictures/Glint");
        assert_eq!(resolve("D:/Shots", def), PathBuf::from("D:/Shots"));
    }
}
```

- [ ] **Step 4: Declare the module**

In `glint/src-tauri/src/settings/mod.rs`, next to `pub mod commands;` add:

```rust
pub mod locations;
```

- [ ] **Step 5: Run tests**

Run: `cd glint/src-tauri && cargo test settings::`
Expected: PASS — the new `locations::tests` + the existing `apply_update` tests (defaults roundtrip still holds because new fields have defaults).

- [ ] **Step 6: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs glint/src-tauri/src/settings/locations.rs
git commit -m "feat(p16): settings fields + save_dir resolver core"
```

---

### Task 2: Wire all save sites to the resolver

**Files:**
- Modify: `glint/src-tauri/src/capture/commands.rs:186-187` and `:402-403`
- Modify: `glint/src-tauri/src/editor/commands.rs:164-165`
- Modify: `glint/src-tauri/src/pin.rs:209-210`
- Modify: `glint/src-tauri/src/recorder/mod.rs:567-571`

**Interfaces:**
- Consumes: `crate::settings::locations::{save_dir, SaveKind}` (Task 1).

- [ ] **Step 1: capture/commands.rs — finish_commit (auto-save)**

Replace lines 186–187:

```rust
        let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
        let dir = crate::paths::glint_save_dir(&pictures);
```

with:

```rust
        let dir = crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Screenshot);
```

- [ ] **Step 2: capture/commands.rs — tray_save**

Replace lines 402–403 (same two lines, inside `tray_save`):

```rust
    let pictures = app.path().picture_dir().map_err(|e| e.to_string())?;
    let dir = crate::paths::glint_save_dir(&pictures);
```

with:

```rust
    let dir = crate::settings::locations::save_dir(&app, crate::settings::locations::SaveKind::Screenshot);
```

(Note the `&app` — `tray_save` owns `app: AppHandle`; `finish_commit` has `app: &AppHandle`. Match each site's binding.)

- [ ] **Step 3: editor/commands.rs — save to Library**

Replace lines 164–165 with:

```rust
    let dir = crate::settings::locations::save_dir(&app, crate::settings::locations::SaveKind::Screenshot);
```

(Use `&app` or `app` to match the surrounding function's handle type — check whether it's `AppHandle` or `&AppHandle` and match.)

- [ ] **Step 4: pin.rs — save to Library**

Replace lines 209–210 with:

```rust
    let dir = crate::settings::locations::save_dir(&app, crate::settings::locations::SaveKind::Screenshot);
```

(Match the handle binding as above.)

- [ ] **Step 5: recorder/mod.rs — output dir (isolation-safe settings import)**

Replace lines 567–571:

```rust
    let videos = app.path().video_dir().map_err(|e| {
        let _ = app.emit("glint-toast", "Couldn't start the recorder");
        e.to_string()
    })?;
    let dir = videos.join("Glint");
```

with:

```rust
    // Honor the custom capture folder (falls back to Videos\Glint). Reading `settings` is
    // isolation-safe — the sacred rule only forbids capture/editor/overlay/ocr imports.
    let dir = crate::settings::locations::save_dir(app, crate::settings::locations::SaveKind::Recording);
```

- [ ] **Step 6: Build + full Rust suite (no behavior change when save_dir empty)**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: builds; all existing tests pass (empty `save_dir` → identical dirs). If `crate::paths::glint_save_dir` becomes unused, leave it (still used by its own unit tests).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/editor/commands.rs glint/src-tauri/src/pin.rs glint/src-tauri/src/recorder/mod.rs
git commit -m "feat(p16): route all save sites through the save_dir resolver"
```

---

### Task 3: `storage_paths` + `settings_set_save_dir` commands

**Files:**
- Modify: `glint/src-tauri/src/settings/commands.rs` (two commands + a struct)
- Modify: `glint/src-tauri/src/lib.rs` (register both)

**Interfaces:**
- Consumes: `locations::{save_dir, SaveKind}` (Task 1); `SettingsState`, `Settings`.
- Produces (commands): `storage_paths() -> StoragePaths`, `settings_set_save_dir(app, path) -> Result<Settings, String>`.

- [ ] **Step 1: Add the commands**

Append to `glint/src-tauri/src/settings/commands.rs` (ensure `use tauri::{AppHandle, Manager};` — `Manager` for `app.path()`; merge with existing `use tauri::...` lines, don't duplicate `State`):

```rust
use serde::Serialize;

use super::locations::{save_dir, SaveKind};

/// Real, effective on-disk locations for the Storage panel (replaces the old hardcoded text).
#[derive(Serialize)]
pub struct StoragePaths {
    pub screenshots: String,
    pub recordings: String,
    pub database: String,
    pub logs: String,
}

#[tauri::command]
pub fn storage_paths(app: AppHandle) -> StoragePaths {
    let s = |p: std::path::PathBuf| p.to_string_lossy().to_string();
    let database = app
        .path()
        .app_config_dir()
        .map(|d| d.join("glint.db"))
        .map(s)
        .unwrap_or_default();
    let logs = app.path().app_log_dir().map(s).unwrap_or_default();
    StoragePaths {
        screenshots: s(save_dir(&app, SaveKind::Screenshot)),
        recordings: s(save_dir(&app, SaveKind::Recording)),
        database,
        logs,
    }
}

/// Set (or clear, when empty) the custom capture folder. A non-empty path must be creatable
/// and writable. Persists in SettingsState; the frontend also mirrors it to the DB.
#[tauri::command]
pub fn settings_set_save_dir(app: AppHandle, path: String) -> Result<Settings, String> {
    let trimmed = path.trim().to_string();
    if !trimmed.is_empty() {
        let p = std::path::Path::new(&trimmed);
        std::fs::create_dir_all(p).map_err(|_| "That folder can't be created.".to_string())?;
        // Writability probe: a temp file we immediately remove.
        let probe = p.join(".glint-write-test");
        std::fs::write(&probe, b"").map_err(|_| "That folder isn't writable.".to_string())?;
        let _ = std::fs::remove_file(&probe);
    }
    let state = app.state::<SettingsState>();
    let mut s = state.0.lock().unwrap();
    s.save_dir = trimmed;
    Ok(s.clone())
}
```

- [ ] **Step 2: Register the commands**

In `glint/src-tauri/src/lib.rs`, add `storage_paths, settings_set_save_dir` to the `use settings::commands::{…}` import and to the `generate_handler![…]` list.

- [ ] **Step 3: Build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/settings/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p16): storage_paths + settings_set_save_dir commands"
```

---

### Task 4: Launch at login (registry autostart)

**Files:**
- Create: `glint/src-tauri/src/autostart.rs`
- Modify: `glint/src-tauri/src/lib.rs` (`mod autostart;` + register two commands)
- Modify: `glint/src-tauri/src/settings/commands.rs` (two thin command wrappers)

**Interfaces:**
- Produces: `autostart::{is_enabled() -> bool, set_enabled(on: bool) -> Result<(), String>}`; commands `autostart_get() -> bool`, `autostart_set(on) -> Result<(), String>`.

- [ ] **Step 1: Write the autostart helper**

Create `glint/src-tauri/src/autostart.rs`:

```rust
//! Launch-at-login via the HKCU Run key. The registry is the source of truth (not the
//! settings table): the toggle reads/writes the real value so it always reflects reality.

use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const RUN_PATH: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "Glint";

fn exe_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// True when the Run value exists (Glint is set to start at login).
pub fn is_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.open_subkey(RUN_PATH) {
        Ok(run) => run.get_value::<String, _>(VALUE_NAME).is_ok(),
        Err(_) => false,
    }
}

/// Add or remove the Run value (quoted exe path). Deleting a missing value is not an error.
pub fn set_enabled(on: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (run, _) = hkcu.create_subkey(RUN_PATH).map_err(|e| e.to_string())?;
    if on {
        let exe = exe_path()?;
        run.set_value(VALUE_NAME, &format!("\"{exe}\"")).map_err(|e| e.to_string())?;
    } else {
        let _ = run.delete_value(VALUE_NAME);
    }
    Ok(())
}
```

- [ ] **Step 2: Add command wrappers**

Append to `glint/src-tauri/src/settings/commands.rs`:

```rust
#[tauri::command]
pub fn autostart_get() -> bool {
    crate::autostart::is_enabled()
}

#[tauri::command]
pub fn autostart_set(on: bool) -> Result<(), String> {
    crate::autostart::set_enabled(on)
}
```

- [ ] **Step 3: Declare module + register commands**

In `glint/src-tauri/src/lib.rs`: add `mod autostart;` near the other `mod` lines; add `autostart_get, autostart_set` to the settings-commands `use` import and to `generate_handler![…]`.

- [ ] **Step 4: Build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds (`winreg` is already a dependency).

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/autostart.rs glint/src-tauri/src/settings/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p16): launch-at-login via HKCU Run key"
```

---

### Task 5: Sound effects (WAV synth + playback)

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `Win32_Media_Audio` feature)
- Create: `glint/src-tauri/src/settings/sound.rs`
- Modify: `glint/src-tauri/src/settings/mod.rs` (`pub mod sound;`)
- Modify: `glint/src-tauri/src/capture/commands.rs::finish_commit` (play when enabled)

**Interfaces:**
- Produces: `sound::{shutter_wav() -> Vec<u8>, play_shutter()}`.

- [ ] **Step 1: Enable the audio feature**

In `glint/src-tauri/Cargo.toml`, add to the `windows = { … features = [ … ] }` list:

```toml
    "Win32_Media_Audio",
```

- [ ] **Step 2: Write the shutter synth with a failing test**

Create `glint/src-tauri/src/settings/sound.rs`:

```rust
//! A short camera-shutter click, synthesized as an in-memory PCM WAV (no shipped asset) and
//! played asynchronously via Win32 PlaySound. Fully local.

use std::sync::OnceLock;

/// Little-endian PCM16 mono WAV of a two-click shutter (~120 ms). Deterministic.
pub fn shutter_wav() -> Vec<u8> {
    let sample_rate: u32 = 44_100;
    let n = (sample_rate as f32 * 0.12) as usize;
    let mut samples: Vec<i16> = Vec::with_capacity(n);
    // xorshift so we need no rng dependency and stay deterministic.
    let mut seed: u64 = 0x2545_F491_4F6C_DD1D;
    let mut noise = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        ((seed >> 40) as i32 as f32) / 8_388_608.0 - 1.0
    };
    for i in 0..n {
        let t = i as f32 / sample_rate as f32;
        // Two decaying clicks (shutter open + close).
        let env = (-t * 60.0).exp() + 0.7 * (-((t - 0.05).max(0.0)) * 55.0).exp();
        let s = (noise() * env * 0.5).clamp(-1.0, 1.0);
        samples.push((s * i16::MAX as f32) as i16);
    }
    encode_wav_mono(&samples, sample_rate)
}

fn encode_wav_mono(samples: &[i16], sample_rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut v = Vec::with_capacity(44 + data_len as usize);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVE");
    v.extend_from_slice(b"fmt ");
    v.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    v.extend_from_slice(&1u16.to_le_bytes()); // PCM
    v.extend_from_slice(&1u16.to_le_bytes()); // mono
    v.extend_from_slice(&sample_rate.to_le_bytes());
    v.extend_from_slice(&(sample_rate * 2).to_le_bytes()); // byte rate
    v.extend_from_slice(&2u16.to_le_bytes()); // block align
    v.extend_from_slice(&16u16.to_le_bytes()); // bits/sample
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        v.extend_from_slice(&s.to_le_bytes());
    }
    v
}

/// Play the shutter click asynchronously. The WAV bytes live in a process-lifetime static so
/// they stay valid during SND_ASYNC | SND_MEMORY playback.
pub fn play_shutter() {
    static SHUTTER: OnceLock<Vec<u8>> = OnceLock::new();
    let wav = SHUTTER.get_or_init(shutter_wav);
    #[cfg(windows)]
    unsafe {
        use windows::core::PCWSTR;
        use windows::Win32::Media::Audio::{PlaySoundW, SND_ASYNC, SND_MEMORY};
        let _ = PlaySoundW(PCWSTR(wav.as_ptr() as *const u16), None, SND_MEMORY | SND_ASYNC);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shutter_wav_has_valid_riff_header() {
        let wav = shutter_wav();
        assert!(wav.len() > 44);
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
    }
}
```

- [ ] **Step 3: Declare the module**

In `glint/src-tauri/src/settings/mod.rs`, add:

```rust
pub mod sound;
```

- [ ] **Step 4: Run the synth test**

Run: `cd glint/src-tauri && cargo test settings::sound::`
Expected: PASS (`shutter_wav_has_valid_riff_header`).

- [ ] **Step 5: Play on capture when enabled**

In `glint/src-tauri/src/capture/commands.rs::finish_commit`, right after the durable file is written (just after the `let path_str = path.to_string_lossy().to_string();` line, before the clipboard copy), add:

```rust
    // Shutter click (opt-in). Non-fatal, async — never blocks the HUD.
    if app.state::<crate::settings::commands::SettingsState>().0.lock().unwrap().sound_effects {
        crate::settings::sound::play_shutter();
    }
```

- [ ] **Step 6: Build + test (Cargo feature change = full recompile)**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build && cargo test
```
Expected: builds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/src/settings/sound.rs glint/src-tauri/src/settings/mod.rs glint/src-tauri/src/capture/commands.rs
git commit -m "feat(p16): synthesized shutter sound on capture (opt-in)"
```

---

### Task 6: Show in taskbar

**Files:**
- Modify: `glint/src-tauri/src/settings/commands.rs` (`window_set_taskbar` command)
- Modify: `glint/src-tauri/src/lib.rs` (register + apply at startup)

**Interfaces:**
- Produces: command `window_set_taskbar(app, on: bool) -> Result<(), String>`.

- [ ] **Step 1: Add the command**

Append to `glint/src-tauri/src/settings/commands.rs`:

```rust
/// Show/hide the main window's taskbar button (the tray icon is unaffected).
#[tauri::command]
pub fn window_set_taskbar(app: AppHandle, on: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_skip_taskbar(!on).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

- [ ] **Step 2: Register + apply at startup**

In `glint/src-tauri/src/lib.rs`: add `window_set_taskbar` to the settings-commands `use` + `generate_handler![…]`. Then in the `.setup(|app| { … })` closure (after settings are hydrated and the main window exists), add:

```rust
            // Apply the persisted taskbar preference to the main window.
            {
                let show = app.state::<settings::commands::SettingsState>().0.lock().unwrap().show_in_taskbar;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_skip_taskbar(!show);
                }
            }
```

(Place it where `app` is a `&App`/`AppHandle` with `Manager` in scope — alongside the existing shortcut registration in setup. Use `app.handle()` if the closure binds `app: &mut App`.)

- [ ] **Step 3: Build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds.

- [ ] **Step 4: Commit**

```bash
git add glint/src-tauri/src/settings/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p16): show-in-taskbar toggle + startup apply"
```

---

### Task 7: Include cursor (Win32 compositing)

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `Win32_Graphics_Gdi` feature)
- Create: `glint/src-tauri/src/capture/cursor.rs`
- Modify: `glint/src-tauri/src/capture/mod.rs` (`pub mod cursor;` + call in `begin_restoring` when enabled)

**Interfaces:**
- Produces: `cursor::composite_cursor(rgba: &mut [u8], width: u32, height: u32, origin_x: i32, origin_y: i32)`.

- [ ] **Step 1: Enable the GDI feature**

In `glint/src-tauri/Cargo.toml`, add to the `windows` features list:

```toml
    "Win32_Graphics_Gdi",
```

- [ ] **Step 2: Write the cursor compositor**

Create `glint/src-tauri/src/capture/cursor.rs`:

```rust
//! Composite the live mouse cursor onto a frozen RGBA frame (opt-in "include cursor"). Pure
//! Win32/GDI; stays inside `capture/`. Never panics — any failure or a hidden cursor is a
//! logged no-op so the screenshot still succeeds.

#[cfg(windows)]
pub fn composite_cursor(rgba: &mut [u8], width: u32, height: u32, origin_x: i32, origin_y: i32) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, HICON,
        ICONINFO,
    };

    const CURSOR_SIZE: i32 = 64; // large enough for any standard/large cursor

    unsafe {
        let mut ci = CURSORINFO {
            cbSize: std::mem::size_of::<CURSORINFO>() as u32,
            ..Default::default()
        };
        if GetCursorInfo(&mut ci).is_err() || (ci.flags.0 & CURSOR_SHOWING.0) == 0 {
            return;
        }
        let hcursor = HICON(ci.hCursor.0);

        let mut ii = ICONINFO::default();
        if GetIconInfo(hcursor, &mut ii).is_err() {
            return;
        }
        // Hotspot: where the click-point sits inside the cursor image.
        let hotspot = POINT { x: ii.xHotspot as i32, y: ii.yHotspot as i32 };
        if !ii.hbmMask.is_invalid() {
            let _ = DeleteObject(ii.hbmMask.into());
        }
        if !ii.hbmColor.is_invalid() {
            let _ = DeleteObject(ii.hbmColor.into());
        }

        // Draw the cursor into a 32bpp top-down DIB with a known-zero background, then read
        // its BGRA back. DrawIconEx writes color where the cursor is opaque.
        let hdc: HDC = CreateCompatibleDC(None);
        if hdc.is_invalid() {
            return;
        }
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: CURSOR_SIZE,
                biHeight: -CURSOR_SIZE, // negative = top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbmp = CreateDIBSection(Some(hdc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0);
        let hbmp = match hbmp {
            Ok(h) if !h.is_invalid() && !bits.is_null() => h,
            _ => {
                let _ = DeleteDC(hdc);
                return;
            }
        };
        let old = SelectObject(hdc, hbmp.into());

        let drawn = DrawIconEx(hdc, 0, 0, hcursor, CURSOR_SIZE, CURSOR_SIZE, 0, None, DI_NORMAL)
            .is_ok();

        if drawn {
            let buf = std::slice::from_raw_parts(bits as *const u8, (CURSOR_SIZE * CURSOR_SIZE * 4) as usize);
            // Destination top-left of the cursor image on the frozen frame.
            let dst_x = ci.ptScreenPos.x - origin_x - hotspot.x;
            let dst_y = ci.ptScreenPos.y - origin_y - hotspot.y;
            for cy in 0..CURSOR_SIZE {
                for cx in 0..CURSOR_SIZE {
                    let ci4 = ((cy * CURSOR_SIZE + cx) * 4) as usize;
                    let b = buf[ci4];
                    let g = buf[ci4 + 1];
                    let r = buf[ci4 + 2];
                    let a = buf[ci4 + 3];
                    // DrawIconEx on a zeroed DIB leaves transparent pixels at (0,0,0,0).
                    // Treat any non-zero pixel as cursor ink; alpha-blend when alpha present.
                    if b == 0 && g == 0 && r == 0 && a == 0 {
                        continue;
                    }
                    let px = dst_x + cx;
                    let py = dst_y + cy;
                    if px < 0 || py < 0 || px >= width as i32 || py >= height as i32 {
                        continue;
                    }
                    let di = ((py as u32 * width + px as u32) * 4) as usize;
                    if di + 3 >= rgba.len() {
                        continue;
                    }
                    let alpha = if a == 0 { 255u32 } else { a as u32 };
                    let inv = 255 - alpha;
                    // rgba buffer is RGBA; cursor DIB is BGRA.
                    rgba[di] = ((r as u32 * alpha + rgba[di] as u32 * inv) / 255) as u8;
                    rgba[di + 1] = ((g as u32 * alpha + rgba[di + 1] as u32 * inv) / 255) as u8;
                    rgba[di + 2] = ((b as u32 * alpha + rgba[di + 2] as u32 * inv) / 255) as u8;
                    rgba[di + 3] = 255;
                }
            }
        }

        SelectObject(hdc, old);
        let _ = DeleteObject(hbmp.into());
        let _ = DeleteDC(hdc);
    }
}

#[cfg(not(windows))]
pub fn composite_cursor(_rgba: &mut [u8], _width: u32, _height: u32, _origin_x: i32, _origin_y: i32) {}
```

- [ ] **Step 3: Declare module + call at freeze time**

In `glint/src-tauri/src/capture/mod.rs`: add `pub mod cursor;` near the other module declarations. Then in `begin_restoring`, right after the successful `capturer.capture_primary()` (the `let image = match … { Ok(img) => img, … }` block, before building the `CaptureSession`), add:

```rust
    // Bake the cursor into the frozen frame when the user opted in.
    let include_cursor = app
        .state::<crate::settings::commands::SettingsState>()
        .0
        .lock()
        .unwrap()
        .include_cursor;
    let mut image = image;
    if include_cursor {
        let (ox, oy) = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|m| (m.position().x, m.position().y))
            .unwrap_or((0, 0));
        cursor::composite_cursor(&mut image.rgba, image.width, image.height, ox, oy);
    }
```

(`image` is currently bound immutably; the `let mut image = image;` re-binding makes it mutable for the composite. Leave the rest of `begin_restoring` unchanged.)

- [ ] **Step 4: Build (Cargo feature change = full recompile)**

Run:
```bash
powershell -NoProfile -Command "Stop-Process -Name glint -Force -ErrorAction SilentlyContinue; exit 0"
cd glint/src-tauri && cargo build
```
Expected: builds. If a `windows` API name/shape differs in 0.62 (e.g. `HICON(ci.hCursor.0)` or `BI_RGB.0`), adjust to the crate's exact types — the approach is unchanged.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/src/capture/cursor.rs glint/src-tauri/src/capture/mod.rs
git commit -m "feat(p16): include-cursor compositing at freeze time (opt-in)"
```

---

### Task 8: Frontend — Storage panel (folder picker + real paths)

**Files:**
- Modify: `glint/src/lib/ipc.ts` (wrappers + `StoragePaths` type)
- Modify: `glint/src/store/useAppStore.ts` (`Settings` fields + `setSaveDir`)
- Rewrite: `glint/src/views/settings/Storage.tsx`
- Modify: `glint/src/views/settings.css` (folder-row styles)

**Interfaces:**
- Consumes: commands `storage_paths`, `settings_set_save_dir` (Task 3); a new `reveal_path` command (added here — no path-based reveal exists; all current reveal commands take an id). Uses `plugin-dialog` `open`.

- [ ] **Step 1a: Add a path-based reveal command (Rust)**

There is no path-based reveal command yet (`tray_reveal`/`capture_reveal` take ids; `reveal_in_explorer(path: &str)` is a private helper in `capture/commands.rs`). Add a thin command near `capture_reveal` in `glint/src-tauri/src/capture/commands.rs`:

```rust
/// Reveal an arbitrary file/folder path in Explorer (used by the Storage folder controls).
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    reveal_in_explorer(&path)
}
```

Register `reveal_path` in `glint/src-tauri/src/lib.rs` (add to the `use capture::commands::{…}` import and to `generate_handler![…]`).

- [ ] **Step 1b: Add IPC wrappers + type**

In `glint/src/lib/ipc.ts` add (near `saveSetting`):

```ts
export type StoragePaths = {
  screenshots: string;
  recordings: string;
  database: string;
  logs: string;
};

export async function storagePaths(): Promise<StoragePaths> {
  return invoke<StoragePaths>("storage_paths");
}

/** Set (or clear, with "") the custom capture folder. Rejects on unwritable path. */
export async function setSaveDir(path: string): Promise<Settings> {
  return invoke<Settings>("settings_set_save_dir", { path });
}

/** Reveal an arbitrary path in Windows Explorer. */
export async function revealPath(path: string): Promise<void> {
  await invoke("reveal_path", { path });
}
```

- [ ] **Step 2: Extend the store `Settings` type + add `setSaveDir`**

In `glint/src/store/useAppStore.ts`, add to the `Settings` interface:

```ts
  save_dir: string;
  sound_effects: boolean;
  show_in_taskbar: boolean;
  include_cursor: boolean;
```

Import `setSaveDir as setSaveDirIpc` from `../lib/ipc` (add to the existing import). Add to the `AppState` interface:

```ts
  setSaveDir: (path: string) => Promise<void>;
```

Add the implementation (near the other setters):

```ts
  setSaveDir: async (path: string) => {
    const updated = await setSaveDirIpc(path); // throws on unwritable
    await persistSetting("save_dir", path);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 3: Rewrite the Storage panel**

Replace `glint/src/views/settings/Storage.tsx`:

```tsx
import { useEffect, useState } from "react";
import { HardDrive, FolderOpen, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Section, Field, Card } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { storagePaths, revealPath, type StoragePaths } from "../../lib/ipc";

export function Storage() {
  const settings = useAppStore((s) => s.settings);
  const setSaveDir = useAppStore((s) => s.setSaveDir);
  const pushToast = useAppStore((s) => s.pushToast);
  const [paths, setPaths] = useState<StoragePaths | null>(null);

  const refresh = () => storagePaths().then(setPaths).catch(() => setPaths(null));
  useEffect(() => { refresh(); }, [settings?.save_dir]);

  async function choose() {
    const dir = await open({ directory: true, multiple: false, title: "Choose capture folder" });
    if (typeof dir === "string") {
      try {
        await setSaveDir(dir);
        pushToast("Capture folder updated");
      } catch (e) {
        pushToast(String(e));
      }
    }
  }

  async function resetDefault() {
    try {
      await setSaveDir("");
      pushToast("Reverted to the default folder");
    } catch (e) {
      pushToast(String(e));
    }
  }

  const custom = (settings?.save_dir ?? "") !== "";

  return (
    <Section title="Storage" description="Where Glint stores your data on disk.">
      <Card>
        <div className="settings-storage-list">
          {[
            ["Screenshots", paths?.screenshots],
            ["Recordings", paths?.recordings],
            ["Database", paths?.database],
            ["Logs", paths?.logs],
          ].map(([label, value]) => (
            <div className="settings-storage-row" key={label}>
              <span className="settings-storage-key">
                <HardDrive size={13} strokeWidth={1.75} />
                {label}
              </span>
              <code className="settings-storage-path">{value ?? "…"}</code>
            </div>
          ))}
        </div>
      </Card>

      <Field label="Capture folder" hint="Where new screenshots and recordings are saved. Existing files aren't moved.">
        <div className="settings-folder-control">
          <code className="settings-folder-path">{paths?.screenshots ?? "…"}</code>
          <div className="settings-folder-actions">
            <button type="button" className="settings-hotkey-btn" onClick={() => void choose()}>
              <FolderOpen size={13} strokeWidth={1.75} /> Choose…
            </button>
            <button
              type="button"
              className="settings-hotkey-btn"
              onClick={() => paths && void revealPath(paths.screenshots)}
            >
              Reveal
            </button>
            {custom && (
              <button type="button" className="settings-hotkey-btn settings-hotkey-btn--ghost" onClick={() => void resetDefault()}>
                <RotateCcw size={13} strokeWidth={1.75} /> Reset
              </button>
            )}
          </div>
        </div>
      </Field>
    </Section>
  );
}
```

- [ ] **Step 4: Add folder-control styles**

Append to `glint/src/views/settings.css`:

```css
.settings-folder-control { display: flex; flex-direction: column; gap: 8px; }
.settings-folder-path {
  font-size: 12px; opacity: 0.85; word-break: break-all;
  padding: 6px 8px; border-radius: 6px; background: rgba(128,128,128,0.1);
}
.settings-folder-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.settings-folder-actions .settings-hotkey-btn { display: inline-flex; align-items: center; gap: 5px; }
```

- [ ] **Step 5: Typecheck**

Run: `cd glint && npx tsc --noEmit`
Expected: clean. (Resolve the `revealPath` import per the Step 3 note.)

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/ipc.ts glint/src/store/useAppStore.ts glint/src/views/settings/Storage.tsx glint/src/views/settings.css glint/src-tauri/src/capture/commands.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p16): Storage panel — folder picker + real effective paths"
```

---

### Task 9: Frontend — General + Capture toggles

**Files:**
- Modify: `glint/src/lib/ipc.ts` (autostart + taskbar wrappers)
- Modify: `glint/src/store/useAppStore.ts` (`setSoundEffects`, `setShowInTaskbar`, `setIncludeCursor`)
- Modify: `glint/src/views/settings/General.tsx` (Launch at login, Sound effects, Show in taskbar)
- Modify: `glint/src/views/settings/Capture.tsx` (Include cursor)

**Interfaces:**
- Consumes: commands `autostart_get/set`, `window_set_taskbar` (Tasks 4/6); `saveSetting`/`persistSetting`.

- [ ] **Step 1: IPC wrappers**

In `glint/src/lib/ipc.ts` add:

```ts
export async function autostartGet(): Promise<boolean> {
  return invoke<boolean>("autostart_get");
}
export async function autostartSet(on: boolean): Promise<void> {
  await invoke("autostart_set", { on });
}
export async function windowSetTaskbar(on: boolean): Promise<void> {
  await invoke("window_set_taskbar", { on });
}
```

- [ ] **Step 2: Store setters**

In `glint/src/store/useAppStore.ts`, add to `AppState` + implement (near `setRecordFx`):

```ts
  setSoundEffects: (on: boolean) => Promise<void>;
  setShowInTaskbar: (on: boolean) => Promise<void>;
  setIncludeCursor: (on: boolean) => Promise<void>;
```

```ts
  setSoundEffects: async (on: boolean) => {
    const updated = await saveSetting("sound_effects", on);
    await persistSetting("sound_effects", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
  setShowInTaskbar: async (on: boolean) => {
    const updated = await saveSetting("show_in_taskbar", on);
    await persistSetting("show_in_taskbar", on);
    await windowSetTaskbar(on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
  setIncludeCursor: async (on: boolean) => {
    const updated = await saveSetting("include_cursor", on);
    await persistSetting("include_cursor", on);
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

(Add `windowSetTaskbar` to the `../lib/ipc` import.)

- [ ] **Step 3: General panel — wire the three toggles**

In `glint/src/views/settings/General.tsx`, replace the three disabled placeholder Fields (Launch at login, Show in taskbar, Sound effects) with live ones. Launch-at-login uses local state seeded from `autostartGet()`:

```tsx
import { useEffect, useState } from "react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
import { autostartGet, autostartSet } from "../../lib/ipc";

export function General() {
  const settings = useAppStore((s) => s.settings);
  const setExplorerMenu = useAppStore((s) => s.setExplorerMenu);
  const setShowInTaskbar = useAppStore((s) => s.setShowInTaskbar);
  const setSoundEffects = useAppStore((s) => s.setSoundEffects);
  const pushToast = useAppStore((s) => s.pushToast);

  const [autostart, setAutostart] = useState(false);
  useEffect(() => { autostartGet().then(setAutostart).catch(() => {}); }, []);

  async function toggleAutostart(on: boolean) {
    try {
      await autostartSet(on);
      setAutostart(on);
      pushToast(on ? "Glint will launch at login" : "Launch at login disabled");
    } catch {
      pushToast("Couldn't update launch at login");
      autostartGet().then(setAutostart).catch(() => {});
    }
  }

  return (
    <Section title="General" description="App-wide behaviour settings.">
      <Field
        label="Open in Glint (right-click menu)"
        hint="Add an &quot;Open in Glint&quot; entry to the Windows Explorer right-click menu for image files (opens the editor) and video files (opens the trimmer)."
      >
        <Switch checked={settings?.explorer_menu_enabled ?? true} onChange={(v) => setExplorerMenu(v)} />
      </Field>
      <Field label="Launch at login" hint="Start Glint automatically when you sign in to Windows.">
        <Switch checked={autostart} onChange={(v) => void toggleAutostart(v)} />
      </Field>
      <Field label="Show in taskbar" hint="Keep Glint's main window visible in the Windows taskbar alongside the tray.">
        <Switch checked={settings?.show_in_taskbar ?? true} onChange={(v) => void setShowInTaskbar(v)} />
      </Field>
      <Field label="Sound effects" hint="Play a shutter sound on capture.">
        <Switch checked={settings?.sound_effects ?? false} onChange={(v) => void setSoundEffects(v)} />
      </Field>
    </Section>
  );
}
```

- [ ] **Step 4: Capture panel — wire Include cursor**

In `glint/src/views/settings/Capture.tsx`, replace the "Include cursor" placeholder Field with a live Switch:

```tsx
      <Field label="Include cursor" hint="Bake the mouse pointer into screenshots.">
        <Switch
          checked={settings?.include_cursor ?? false}
          onChange={(v) => void setIncludeCursor(v)}
        />
      </Field>
```

Add the needed imports/hooks at the top of `Capture.tsx`:

```tsx
import { Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";
```

and inside the component:

```tsx
  const settings = useAppStore((s) => s.settings);
  const setIncludeCursor = useAppStore((s) => s.setIncludeCursor);
```

(Leave the Image format / JPEG quality placeholders as-is — those are a later phase.)

- [ ] **Step 5: Typecheck + tests**

Run: `cd glint && npx tsc --noEmit && npx vitest run`
Expected: `tsc` clean; all Vitest suites pass.

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/ipc.ts glint/src/store/useAppStore.ts glint/src/views/settings/General.tsx glint/src/views/settings/Capture.tsx
git commit -m "feat(p16): wire launch-at-login, sound, taskbar, include-cursor toggles"
```

---

### Task 10: Green gate, at-screen acceptance & merge

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
Expected: builds; all Rust tests pass (incl. `settings::locations::` + `settings::sound::`).

- [ ] **Step 3: Recorder/OCR isolation greps**

Run:
```bash
cd glint/src-tauri
grep -rnE "use +crate::(capture|editor|overlay|ocr)" src/recorder/ && echo VIOLATION || echo "recorder isolation OK"
grep -rnE "use +crate::recorder" src/ocr/ && echo VIOLATION || echo "ocr isolation OK"
```
Expected: both print "… OK". (The recorder's new `crate::settings` import is allowed — not a sacred module.)

- [ ] **Step 4: At-screen acceptance (with the user)**

Launch `npm run tauri dev`. Verify:
1. **Storage** shows the *real* paths (Screenshots `Pictures\Glint`, Recordings `Videos\Glint`, DB, Logs).
2. **Choose…** a folder → take a screenshot **and** a short recording → both land in the chosen folder; **Reveal** opens it; **Reset** reverts to defaults and new captures return to `Pictures\Glint` / `Videos\Glint`.
3. **Launch at login** ON → reboot (or check `HKCU\…\Run` → value `Glint`); OFF removes it.
4. **Sound effects** ON → a shutter click plays on capture; OFF → silent.
5. **Show in taskbar** OFF → the main window's taskbar button disappears (tray icon stays); persists across restart.
6. **Include cursor** ON → the mouse pointer is baked into a new screenshot; OFF → absent.
7. Existing hotkeys/library/recorder still work; recordings still play/trim.

- [ ] **Step 5: Merge to master**

After the user confirms:
```bash
cd "C:/Users/sanir/Claude Code/glint"
git checkout master
git merge --no-ff phase-16-settings-gaps -m "merge: Phase 16 — Settings Gaps (custom folder, launch-at-login, sound, taskbar, cursor)"
git branch -d phase-16-settings-gaps
```

---

## Notes for the implementer

- **Run `npx`/`cargo`/`git` from the directory in each command.** Repo root is `C:\Users\sanir\Claude Code`; frontend in `glint/`, Rust in `glint/src-tauri/`.
- **Dev-server exe lock:** if `cargo build` can't write `glint.exe`, run `Stop-Process -Name glint -Force` first.
- **Never touch** `glint/src-tauri/src/recorder/` except the single output-dir line in Task 2 Step 5.
- **`windows` 0.62 API drift:** the cursor code (Task 7) uses real Win32 types; if an exact name/newtype differs in 0.62, fix to the crate's shape — the algorithm (GetCursorInfo → GetIconInfo → DrawIconEx into a top-down 32bpp DIB → alpha-composite) stays the same.
- **Handle bindings:** save-site edits (Task 2) must match each function's `app: AppHandle` vs `app: &AppHandle` — pass `app` or `&app` accordingly.
- **Do not** implement image format/JPEG quality, retention, or recorder fps/codec — later phases.
