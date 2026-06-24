# "Open in Glint" (Phase 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Right-click any image in Windows Explorer → "Open in Glint" → the annotation editor opens with that image loaded as a new Untitled document.

**Architecture:** A Windows shell verb registered under HKCU (`SystemFileAssociations\image\shell\Glint`) launches `glint.exe "<path>"`. Cold start parses `std::env::args`; warm start routes the path through the existing `tauri-plugin-single-instance` callback. Both funnel into one `open_image_path` that decodes the file, re-encodes to PNG, sets `EditorState` (origin `external`, no doc/project/Library row), and shows the editor. Registration auto-heals on every launch when the (default-ON) `explorer_menu_enabled` setting is on, and is toggleable from Settings. Saving/exporting reuse Phase 5c unchanged — the original file is never modified.

**Tech Stack:** Rust (Tauri v2, `winreg`, `image`, `serde_json`), React 19 + TypeScript + Zustand, Vitest.

## Global Constraints

- **Local-first:** no network, no upload, no accounts, no cloud — registry + local file read only.
- **Single-user / no-auth:** registration is **HKCU-only** → no admin, no UAC.
- **Recorder isolation:** touch only the editor/settings/capture-load path — zero recorder/ffmpeg/scap coupling.
- **Non-destructive:** opening an external image never writes to or overwrites the source file.
- **Visible feedback:** every action gives immediate visible feedback (window to front; toasts on failure) — never silent.
- **Right-click entry caption:** exactly `Open in Glint`.
- **Shell key path:** `Software\Classes\SystemFileAssociations\image\shell\Glint` under `HKEY_CURRENT_USER`.
- **Command string:** exactly `"<exe>" "%1"` (quoted exe, space, quoted `%1`).
- **`explorer_menu_enabled` default = `true`.**
- **Supported image extensions:** `png, jpg, jpeg, webp, bmp, gif` (lowercase compare).
- Settings persistence pattern: Rust `SettingsState` hydrated at startup; the **frontend** is the write path (`saveSetting` + `persistSetting`). Mirror `setOpenInEditor` exactly.

---

### Task 1: Rust `shell_integration` module (registry verb)

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (add `winreg`)
- Create: `glint/src-tauri/src/shell_integration.rs`
- Modify: `glint/src-tauri/src/lib.rs:1-11` (add `mod shell_integration;`)

**Interfaces:**
- Produces:
  - `pub fn expected_command(exe: &str) -> String` → `"<exe>" "%1"`
  - `pub fn register() -> Result<(), String>` (idempotent; fetches `current_exe` internally)
  - `pub fn unregister() -> Result<(), String>`
  - `pub fn is_registered() -> bool` (true only when the stored command equals `expected_command(current_exe)`)
  - `#[tauri::command] pub fn shell_register_explorer_menu() -> Result<(), String>`
  - `#[tauri::command] pub fn shell_unregister_explorer_menu() -> Result<(), String>`

- [ ] **Step 1: Add the `winreg` dependency**

In `glint/src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
winreg = "0.52"
```

- [ ] **Step 2: Write the failing unit tests**

Create `glint/src-tauri/src/shell_integration.rs` with the module body below **but** temporarily leave `register_at`/`unregister_at`/`is_registered_at` unimplemented (`todo!()`) so the tests compile-and-fail. Full tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_command_quotes_exe_and_percent_one() {
        assert_eq!(
            expected_command(r"C:\Program Files\Glint\glint.exe"),
            r#""C:\Program Files\Glint\glint.exe" "%1""#
        );
    }

    #[test]
    fn register_then_is_registered_then_unregister_roundtrips() {
        // Use a throwaway base so the real shell verb is never touched.
        let base = r"Software\Classes\__glint_test__\image\shell\Glint";
        let exe = r"C:\tmp\glint.exe";
        // Clean slate.
        let _ = unregister_at(base);
        assert!(!is_registered_at(base, exe));

        register_at(base, exe).expect("register");
        assert!(is_registered_at(base, exe));
        // A different exe path must read as NOT registered (stale detection).
        assert!(!is_registered_at(base, r"C:\other\glint.exe"));

        unregister_at(base).expect("unregister");
        assert!(!is_registered_at(base, exe));
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd glint/src-tauri && cargo test shell_integration`
Expected: FAIL — `todo!()` panics in `register_at`/`is_registered_at`.

- [ ] **Step 4: Implement the module**

Replace the whole file `glint/src-tauri/src/shell_integration.rs` with:

```rust
//! Windows Explorer "Open in Glint" right-click verb (HKCU, no admin).
//!
//! Registers a single shell verb under the `image` perceived type, which Windows
//! assigns to common raster formats (png/jpg/jpeg/webp/bmp/gif) — one durable
//! entry instead of a per-extension fan-out. HKCU-only honours the no-admin /
//! single-user constraint. Idempotent: `register()` is safe to call on every
//! launch and self-heals a stale exe path after the app is moved or updated.

use winreg::enums::*;
use winreg::RegKey;

/// The shell-verb key under HKEY_CURRENT_USER (real, production location).
const SHELL_KEY: &str = r"Software\Classes\SystemFileAssociations\image\shell\Glint";

/// The launch command we store under `…\Glint\command` (default value).
pub fn expected_command(exe: &str) -> String {
    format!("\"{exe}\" \"%1\"")
}

/// Absolute path to the running executable, as a String.
fn current_exe_string() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())
        .map(|p| p.to_string_lossy().to_string())
}

/// Write the verb (caption + icon + command) at `base`. Idempotent.
fn register_at(base: &str, exe: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu.create_subkey(base).map_err(|e| e.to_string())?;
    key.set_value("", &"Open in Glint").map_err(|e| e.to_string())?;
    key.set_value("Icon", &format!("{exe},0")).map_err(|e| e.to_string())?;
    let (cmd, _) = hkcu
        .create_subkey(format!(r"{base}\command"))
        .map_err(|e| e.to_string())?;
    cmd.set_value("", &expected_command(exe)).map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete the verb (and its `command` subkey) at `base`. Missing key = ok.
fn unregister_at(base: &str) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    match hkcu.delete_subkey_all(base) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// True only when the stored command equals `expected_command(exe)` — so a stale
/// exe path (app moved) reads as NOT registered and triggers a re-register.
fn is_registered_at(base: &str, exe: &str) -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(cmd) = hkcu.open_subkey(format!(r"{base}\command")) else {
        return false;
    };
    let stored: Result<String, _> = cmd.get_value("");
    matches!(stored, Ok(s) if s == expected_command(exe))
}

/// Register the verb at the production location for the current exe.
pub fn register() -> Result<(), String> {
    let exe = current_exe_string()?;
    register_at(SHELL_KEY, &exe)
}

/// Remove the production verb.
pub fn unregister() -> Result<(), String> {
    unregister_at(SHELL_KEY)
}

/// Is the production verb present AND pointing at the current exe?
pub fn is_registered() -> bool {
    match current_exe_string() {
        Ok(exe) => is_registered_at(SHELL_KEY, &exe),
        Err(_) => false,
    }
}

/// Settings-toggle command: add the right-click menu entry.
#[tauri::command]
pub fn shell_register_explorer_menu() -> Result<(), String> {
    register()
}

/// Settings-toggle command: remove the right-click menu entry.
#[tauri::command]
pub fn shell_unregister_explorer_menu() -> Result<(), String> {
    unregister()
}
```

Then add the module declaration in `glint/src-tauri/src/lib.rs` (keep the list alphabetical — insert after `mod settings;`):

```rust
mod settings;
mod shell_integration;
mod shortcuts;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd glint/src-tauri && cargo test shell_integration`
Expected: PASS — 2 tests (`expected_command_*`, `register_then_*`).

- [ ] **Step 6: Verify the build**

Run: `cd glint/src-tauri && cargo build`
Expected: builds clean (commands are not yet wired into the handler — that's Task 4 — so no usage warnings should block; `#[tauri::command]` fns may warn as unused, which is acceptable until Task 4).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/shell_integration.rs glint/src-tauri/src/lib.rs
git commit -m "feat(p6): HKCU shell-verb register/unregister/is_registered + winreg"
```

---

### Task 2: Settings field `explorer_menu_enabled`

**Files:**
- Modify: `glint/src-tauri/src/settings/mod.rs:32-53` (struct + default), `:56-79` (apply_update), `:84-149` (tests)

**Interfaces:**
- Produces: `Settings.explorer_menu_enabled: bool` (default `true`); `apply_update` accepts key `"explorer_menu_enabled"` (bool).

- [ ] **Step 1: Write the failing tests**

In `glint/src-tauri/src/settings/mod.rs`, inside `mod tests`, add:

```rust
    #[test]
    fn defaults_enable_explorer_menu() {
        let s = Settings::default();
        assert!(s.explorer_menu_enabled);
    }

    #[test]
    fn apply_update_sets_explorer_menu_bool() {
        let mut s = Settings::default();
        apply_update(&mut s, "explorer_menu_enabled", json!(false)).unwrap();
        assert!(!s.explorer_menu_enabled);
    }

    #[test]
    fn apply_update_rejects_non_bool_explorer_menu() {
        let mut s = Settings::default();
        assert!(apply_update(&mut s, "explorer_menu_enabled", json!("yes")).is_err());
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `cd glint/src-tauri && cargo test settings::`
Expected: FAIL — `no field explorer_menu_enabled on type Settings`.

- [ ] **Step 3: Add the field, default, and update arm**

In the `Settings` struct (after `pub open_in_editor: bool,`):

```rust
    pub open_in_editor: bool,
    pub explorer_menu_enabled: bool,
```

In `impl Default for Settings` (after `open_in_editor: false,`):

```rust
            open_in_editor: false,
            explorer_menu_enabled: true,
```

In `apply_update`, add an arm before the `other =>` fallback:

```rust
        "explorer_menu_enabled" => {
            s.explorer_menu_enabled =
                value.as_bool().ok_or("explorer_menu_enabled must be boolean")?;
        }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd glint/src-tauri && cargo test settings::`
Expected: PASS — including the 3 new tests.

- [ ] **Step 5: Commit**

```bash
git add glint/src-tauri/src/settings/mod.rs
git commit -m "feat(p6): explorer_menu_enabled setting (default true)"
```

---

### Task 3: `open_image_path` + argv parsing + pending-open state

**Files:**
- Modify: `glint/src-tauri/Cargo.toml` (expand `image` decode features)
- Modify: `glint/src-tauri/src/editor/mod.rs:21-25` (add `PendingOpen` state)
- Modify: `glint/src-tauri/src/editor/commands.rs` (add `first_image_arg`, `open_image_path`, `consume_pending_external_open`)

**Interfaces:**
- Consumes: `EditorSource`, `EditorState`, `open_editor_window` (editor/commands.rs); `crate::capture::frozen::{CapturedImage, encode_png}`.
- Produces:
  - `pub struct PendingOpen(pub Mutex<bool>)` (editor/mod.rs), default false.
  - `pub fn first_image_arg(args: &[String]) -> Option<String>` — first arg (any index) that is an existing file with a supported image extension.
  - `pub fn open_image_path(app: &AppHandle, path: &str, cold: bool) -> Result<(), String>` — decode → PNG → set `EditorState` (origin `"external"`, doc `None`, project_path `None`, capture_id `None`); if `cold`, set `PendingOpen=true`; always `open_editor_window`.
  - `#[tauri::command] pub fn consume_pending_external_open(pending: State<PendingOpen>) -> bool` — returns the flag and resets it to false (one-shot).

- [ ] **Step 1: Expand the `image` crate decode features**

In `glint/src-tauri/Cargo.toml`, change the `image` line to:

```toml
image = { version = "0.25", default-features = false, features = ["png", "jpeg", "webp", "bmp", "gif"] }
```

- [ ] **Step 2: Add the `PendingOpen` state**

In `glint/src-tauri/src/editor/mod.rs`, after the `EditorState` definition:

```rust
#[derive(Default)]
pub struct EditorState(pub Mutex<Option<EditorSource>>);

/// One-shot flag: a cold-start "Open in Glint" launch set an external image into
/// EditorState before the webview mounted. The frontend consumes this on mount to
/// navigate to /editor (the `editor-open` emit can race a not-yet-mounted listener
/// at cold start, so the flag — not the emit — drives cold-start navigation).
#[derive(Default)]
pub struct PendingOpen(pub Mutex<bool>);
```

- [ ] **Step 3: Write the failing test for `first_image_arg`**

In `glint/src-tauri/src/editor/commands.rs`, append a test module. The path-existence cases use a real temp file the test writes:

```rust
#[cfg(test)]
mod tests {
    use super::first_image_arg;

    #[test]
    fn ignores_when_no_image_arg() {
        let args = vec!["glint.exe".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }

    #[test]
    fn ignores_non_image_extension() {
        let args = vec!["glint.exe".to_string(), "C:\\notes.txt".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }

    #[test]
    fn finds_existing_image_file() {
        let dir = std::env::temp_dir();
        let p = dir.join("glint_test_arg.png");
        std::fs::write(&p, b"not really a png, just needs to exist").unwrap();
        let ps = p.to_string_lossy().to_string();
        let args = vec!["glint.exe".to_string(), ps.clone()];
        assert_eq!(first_image_arg(&args), Some(ps));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn ignores_image_extension_that_does_not_exist() {
        let args = vec!["glint.exe".to_string(), "C:\\nope_missing_xyz.png".to_string()];
        assert_eq!(first_image_arg(&args), None);
    }
}
```

- [ ] **Step 4: Run to verify failure**

Run: `cd glint/src-tauri && cargo test editor::commands`
Expected: FAIL — `cannot find function first_image_arg`.

- [ ] **Step 5: Implement `first_image_arg`, `open_image_path`, and the consume command**

In `glint/src-tauri/src/editor/commands.rs`, add to the top imports (the file already imports `AppHandle, Emitter, Manager, State`). Add the `PendingOpen` import:

```rust
use crate::editor::{EditorSource, EditorState, PendingOpen};
```

(replace the existing `use crate::editor::{EditorSource, EditorState};` line).

Then add these functions (place them in the "Project (.glint)" region or just below `editor_source`):

```rust
/// Supported source extensions, matching the `image` decode features and the
/// `image` perceived-type the shell verb is registered under.
const IMAGE_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "webp", "bmp", "gif"];

/// The first argument that points to an existing file with a supported image
/// extension. Pure (no app handle) so it is unit-testable; used by both the
/// cold-start argv parse and the warm-start single-instance callback.
pub fn first_image_arg(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| {
            let lower = a.to_lowercase();
            IMAGE_EXTS.iter().any(|ext| lower.ends_with(&format!(".{ext}")))
                && std::path::Path::new(a).is_file()
        })
        .cloned()
}

/// Load an external image file into the editor as a new Untitled document.
/// Decodes the source, re-encodes to PNG (EditorState always holds PNG bytes),
/// sets origin "external" (no Library row, no doc, no project path). On `cold`
/// start, sets the PendingOpen flag so the frontend navigates on mount. Always
/// shows/focuses the editor window. Never modifies the source file.
pub fn open_image_path(app: &AppHandle, path: &str, cold: bool) -> Result<(), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| {
            let name = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            format!("Couldn't open {name} — not a supported image")
        })?
        .to_rgba8();
    let (width, height) = (decoded.width(), decoded.height());
    let img = crate::capture::frozen::CapturedImage { width, height, rgba: decoded.into_raw() };
    let png = crate::capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;

    if let Some(ed) = app.try_state::<EditorState>() {
        *ed.0.lock().unwrap() = Some(EditorSource {
            png,
            width,
            height,
            origin: "external".into(),
            capture_id: None,
            doc: None,
            project_path: None,
        });
    }
    if cold {
        if let Some(p) = app.try_state::<PendingOpen>() {
            *p.0.lock().unwrap() = true;
        }
    }
    open_editor_window(app);
    Ok(())
}

/// One-shot: returns whether a cold-start external open is pending, resetting the
/// flag. The frontend calls this on mount to decide whether to navigate to /editor.
#[tauri::command]
pub fn consume_pending_external_open(pending: State<PendingOpen>) -> bool {
    let mut p = pending.0.lock().unwrap();
    let was = *p;
    *p = false;
    was
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd glint/src-tauri && cargo test editor::commands`
Expected: PASS — 4 `first_image_arg` tests.

- [ ] **Step 7: Verify the build**

Run: `cd glint/src-tauri && cargo build`
Expected: clean (the new `#[tauri::command]` and `open_image_path` may warn unused until Task 4 wires them — acceptable).

- [ ] **Step 8: Commit**

```bash
git add glint/src-tauri/Cargo.toml glint/src-tauri/Cargo.lock glint/src-tauri/src/editor/mod.rs glint/src-tauri/src/editor/commands.rs
git commit -m "feat(p6): open_image_path + argv parse + pending-open state; image decode features"
```

---

### Task 4: Wire routing + commands + startup self-heal into `lib.rs`

**Files:**
- Modify: `glint/src-tauri/src/lib.rs` — imports, single-instance callback (`:58-60`), `.manage` (`:82-85`), setup self-heal + cold-start (`:86-127`), `invoke_handler` (`:144-171`)

**Interfaces:**
- Consumes: `shell_integration::{is_registered, register, shell_register_explorer_menu, shell_unregister_explorer_menu}`; `editor::commands::{first_image_arg, open_image_path, consume_pending_external_open}`; `editor::PendingOpen`; `settings::commands::SettingsState`.

- [ ] **Step 1: Import the new editor + shell commands**

In `glint/src-tauri/src/lib.rs`, extend the `editor::commands` use-block:

```rust
use editor::commands::{
    consume_pending_external_open, editor_copy, editor_flatten_temp, editor_open_capture,
    editor_open_from_last, editor_save, editor_source, project_open, project_save,
    projects_resolve,
};
use shell_integration::{shell_register_explorer_menu, shell_unregister_explorer_menu};
```

- [ ] **Step 2: Route the path in the single-instance (warm-start) callback**

Replace the callback at `glint/src-tauri/src/lib.rs:58-60`:

```rust
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. "Open in Glint" while Glint is already running)
            // delivers its argv here. If it names an image, open it; otherwise just
            // bring the existing window forward (the prior behaviour).
            match crate::editor::commands::first_image_arg(&argv) {
                Some(path) => {
                    if let Err(e) = crate::editor::commands::open_image_path(app, &path, false) {
                        let _ = tauri::Emitter::emit(app, "glint-toast", e);
                    }
                }
                None => window::focus_main(app),
            }
        }))
```

- [ ] **Step 3: Manage the `PendingOpen` state**

After `.manage(crate::editor::EditorState::default())` (`glint/src-tauri/src/lib.rs:85`), add:

```rust
        .manage(crate::editor::PendingOpen::default())
```

- [ ] **Step 4: Add startup self-heal + cold-start open in `setup`**

In `glint/src-tauri/src/lib.rs`, inside `.setup(...)`, immediately after the settings-hydrate block (just after the closing brace of the `{ let state = app.state::<SettingsState>(); … }` block at `:108`, before `app.manage(Db(...))`), add:

```rust
            // Self-heal the Explorer "Open in Glint" verb: if enabled (default true)
            // and not already registered for THIS exe path, (re)register. HKCU-only,
            // no admin. Startup never removes — the Settings toggle drives removal.
            {
                let enabled = {
                    let state = app.state::<SettingsState>();
                    let s = state.0.lock().unwrap();
                    s.explorer_menu_enabled
                };
                if enabled && !crate::shell_integration::is_registered() {
                    if let Err(e) = crate::shell_integration::register() {
                        log::warn!("explorer menu register failed: {e}");
                    }
                }
            }
```

Then, near the end of `setup` (after the overlay pre-warm block, before `log::info!("Glint started");`), add the cold-start argv open. It runs synchronously so the `PendingOpen` flag is set before the webview mounts and calls `consume_pending_external_open`:

```rust
            // Cold start: launched with an image path ("Open in Glint" while Glint
            // was not running). Decode + load it now (synchronous so the pending
            // flag is set before the webview mounts and reads it).
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(path) = crate::editor::commands::first_image_arg(&args) {
                    if let Err(e) = crate::editor::commands::open_image_path(app.handle(), &path, true) {
                        log::warn!("cold-start open failed: {e}");
                    }
                }
            }
```

- [ ] **Step 5: Register the four new commands in the handler**

In the `invoke_handler![ … ]` list (`glint/src-tauri/src/lib.rs:144-171`), add after `projects_resolve,`:

```rust
            projects_resolve,
            consume_pending_external_open,
            shell_register_explorer_menu,
            shell_unregister_explorer_menu,
```

- [ ] **Step 6: Verify build + full test suite**

Run: `cd glint/src-tauri && cargo build && cargo test`
Expected: builds clean (no unused-warning blockers now that everything is wired); all tests pass (prior suite + Task 1/2/3 additions).

- [ ] **Step 7: Commit**

```bash
git add glint/src-tauri/src/lib.rs
git commit -m "feat(p6): route argv (cold+warm) to editor, self-heal verb, register commands"
```

---

### Task 5: Frontend — settings store, shell wrappers, toggle, cold-start nav

**Files:**
- Create: `glint/src/lib/shell.ts`
- Modify: `glint/src/store/useAppStore.ts` (Settings interface, loadSettings, new `setExplorerMenu` action)
- Modify: `glint/src/views/settings/General.tsx` (real toggle)
- Modify: `glint/src/App.tsx` (consume cold-start pending open)

**Interfaces:**
- Consumes (Rust commands): `shell_register_explorer_menu`, `shell_unregister_explorer_menu`, `consume_pending_external_open`.
- Produces: `useAppStore` gains `settings.explorer_menu_enabled: boolean` + `setExplorerMenu(on: boolean): Promise<void>`.

- [ ] **Step 1: Add the shell IPC wrappers**

Create `glint/src/lib/shell.ts`:

```ts
/**
 * shell.ts — typed wrappers for the Explorer "Open in Glint" shell-verb commands.
 * HKCU-only registry ops; no admin, no network.
 */
import { invoke } from "@tauri-apps/api/core";

export const registerExplorerMenu = (): Promise<void> =>
  invoke<void>("shell_register_explorer_menu");

export const unregisterExplorerMenu = (): Promise<void> =>
  invoke<void>("shell_unregister_explorer_menu");

/** One-shot: did a cold-start "Open in Glint" stash an external image? */
export const consumePendingExternalOpen = (): Promise<boolean> =>
  invoke<boolean>("consume_pending_external_open");
```

- [ ] **Step 2: Extend the settings store**

In `glint/src/store/useAppStore.ts`:

Add to the `Settings` interface (after `open_in_editor: boolean;`):

```ts
  open_in_editor: boolean;
  explorer_menu_enabled: boolean;
```

Add to the `AppState` interface (after `setOpenInEditor: ...`):

```ts
  setOpenInEditor: (on: boolean) => Promise<void>;
  setExplorerMenu: (on: boolean) => Promise<void>;
```

In `loadSettings`, after `let open_in_editor = rustSettings.open_in_editor;`:

```ts
    let open_in_editor = rustSettings.open_in_editor;
    let explorer_menu_enabled = rustSettings.explorer_menu_enabled;
```

Inside the `try` block, after the `open_in_editor` read:

```ts
      const dbExplorerMenu = await readSetting<boolean>("explorer_menu_enabled");
      if (dbExplorerMenu !== null) explorer_menu_enabled = dbExplorerMenu;
```

Update the `merged` object to include the new key:

```ts
    const merged: Settings = { ...rustSettings, theme, accent, auto_save, auto_copy, open_in_editor, explorer_menu_enabled };
```

Add the action after `setOpenInEditor` (note: import the wrappers at the top of the file — `import { registerExplorerMenu, unregisterExplorerMenu } from "../lib/shell";`):

```ts
  setExplorerMenu: async (on: boolean) => {
    const updated = await saveSetting("explorer_menu_enabled", on);
    await persistSetting("explorer_menu_enabled", on);
    try {
      if (on) await registerExplorerMenu();
      else await unregisterExplorerMenu();
      get().pushToast(on ? "Added to right-click menu" : "Removed from right-click menu");
    } catch {
      get().pushToast("Couldn't update the right-click menu");
    }
    set({ settings: { ...get().settings, ...updated } as Settings });
  },
```

- [ ] **Step 3: Wire the General settings toggle**

Replace `glint/src/views/settings/General.tsx` with (keeps the existing disabled placeholders, adds one real toggle at the top):

```tsx
import { Info } from "lucide-react";
import { Section, Field, Switch } from "../../components/ui";
import { useAppStore } from "../../store/useAppStore";

export function General() {
  const settings = useAppStore((s) => s.settings);
  const setExplorerMenu = useAppStore((s) => s.setExplorerMenu);

  return (
    <Section
      title="General"
      description="App-wide behaviour settings."
    >
      <Field
        label="Open in Glint (right-click menu)"
        hint="Add an &quot;Open in Glint&quot; entry to the Windows Explorer right-click menu for image files."
      >
        <Switch
          checked={settings?.explorer_menu_enabled ?? true}
          onChange={(v) => setExplorerMenu(v)}
        />
      </Field>
      <Field label="Launch at login" hint="Start Glint automatically when you sign in to Windows.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Show in taskbar" hint="Keep Glint visible in the Windows taskbar alongside the tray.">
        <div className="settings-inert-control">
          <Switch checked={true} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
      <Field label="Sound effects" hint="Play a shutter sound on capture.">
        <div className="settings-inert-control">
          <Switch checked={false} onChange={() => {}} disabled />
          <span className="settings-phase-note">
            <Info size={12} strokeWidth={1.75} />
            Available in a later phase
          </span>
        </div>
      </Field>
    </Section>
  );
}
```

- [ ] **Step 4: Consume the cold-start pending open in `App.tsx`**

In `glint/src/App.tsx`, add the import:

```ts
import { consumePendingExternalOpen } from "./lib/shell";
```

Add a mount effect (after the existing `loadSettings` effect, before the listeners effect). It navigates to the editor if a cold-start "Open in Glint" stashed an image:

```tsx
  useEffect(() => {
    // Cold start via "Open in Glint": Rust set the external image into EditorState
    // and a one-shot pending flag before this webview mounted. Consume it and
    // navigate; EditorView's mount fetch then loads the image.
    consumePendingExternalOpen()
      .then((pending) => {
        if (pending) router.navigate("/editor");
      })
      .catch(() => {
        // Backend not ready (plain Vite) — nothing to open.
      });
  }, []);
```

- [ ] **Step 5: Verify types + tests + build**

Run: `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: tsc clean; vitest all green (no frontend unit tests were added — existing suite unchanged); vite build clean.

- [ ] **Step 6: Commit**

```bash
git add glint/src/lib/shell.ts glint/src/store/useAppStore.ts glint/src/views/settings/General.tsx glint/src/App.tsx
git commit -m "feat(p6): Settings toggle, shell IPC wrappers, cold-start editor nav"
```

---

### Task 6: Green gate + acceptance doc + roadmap

**Files:**
- Create: `glint/../docs/superpowers/PHASE-6-ACCEPTANCE.md` (i.e. `docs/superpowers/PHASE-6-ACCEPTANCE.md`)
- Modify: `docs/superpowers/ROADMAP.md` (move Phase 6 to Shipped — pending at-screen)
- Modify: `.superpowers/sdd/progress.md` (ledger)

- [ ] **Step 1: Run the full green gate**

Run (Rust): `cd glint/src-tauri && cargo build && cargo test`
Run (frontend): `cd glint && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: all green. Record the exact pass/fail counts.

- [ ] **Step 2: Write the acceptance doc**

Create `docs/superpowers/PHASE-6-ACCEPTANCE.md`:

```markdown
# Phase 6 — "Open in Glint" — Acceptance

**Status:** Built on `phase-6-open-in-glint`; awaiting at-screen acceptance.
**Spec:** specs/2026-06-24-glint-phase6-open-in-glint-design.md
**Plan:** plans/2026-06-24-glint-phase6-open-in-glint.md

## Automated (green gate)
- [ ] `cargo build` OK; `cargo test` green (incl. shell_integration round-trip, settings explorer_menu, first_image_arg).
- [ ] `tsc --noEmit` clean; `vitest run` green; `vite build` clean.

## At-screen (manual)
- [ ] First launch with the toggle ON auto-adds the entry: right-click a PNG/JPG in Explorer → "Open in Glint" appears.
- [ ] Click it while Glint is CLOSED (cold start) → editor opens with the image as an Untitled doc.
- [ ] Click it while Glint is RUNNING (warm start) → existing window comes forward into the editor; no second instance.
- [ ] Annotate + crop + frame → Export writes a PNG to the Library; Save writes a new `.glint`. Original file on disk is unchanged.
- [ ] Settings → General → toggle OFF → entry disappears from the right-click menu (toast confirms); toggle ON → it returns.
- [ ] Right-click a non-image / feed a bad path → friendly toast, no crash.
- [ ] Move/rename glint.exe, relaunch → entry self-heals to the new path.
```

- [ ] **Step 3: Update ROADMAP + progress ledger**

In `docs/superpowers/ROADMAP.md`, move the Phase 6 block under `## Shipped` (mark "*Built — awaiting at-screen.*"). Append a Phase 6 section to `.superpowers/sdd/progress.md` summarizing tasks + green-gate result.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PHASE-6-ACCEPTANCE.md docs/superpowers/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "docs(p6): acceptance checklist + roadmap/ledger"
```

---

## Self-Review notes (author)

- **Spec coverage:** shell verb (T1), auto-register first-run + self-heal (T4 setup), Settings toggle default ON (T2 field + T5 toggle), winreg (T1), cold-start argv (T4 setup + T3), warm-start single-instance (T4 callback + T3), shared `open_image_path` → Untitled external doc (T3), reuse Phase 5c save/export (no change needed — `editor_save`/`project_save` untouched), non-image toast (T3 error → T4 emits on warm), image-crate decode features (T3 Cargo), registry test-subkey (T1 tests), edge cases (stale exe self-heal T1/T4, non-image T3). All covered.
- **No frontend editor-load changes needed:** external sources carry `doc: None`, identical to the existing HUD/Library capture path that `loadFromSource` → `loadDoc` already handles; only navigation (cold start) is new (T5 Step 4).
- **Type consistency:** `first_image_arg(&[String]) -> Option<String>`, `open_image_path(&AppHandle,&str,bool)`, `PendingOpen(Mutex<bool>)`, `consume_pending_external_open -> bool`, `explorer_menu_enabled: bool`, `setExplorerMenu(boolean)` — names match across all tasks.
- **Risky tasks (reviewer subagent):** Task 1 (registry writes), Task 3 (external-input decode + argv). Tasks 2, 5, 6 mechanical → inline. Task 4 integration glue → judge from diff.
