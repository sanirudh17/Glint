# Phase 6 — "Open in Glint" (Explorer integration + edit any image) — Design

**Status:** Design approved (brainstorming gate passed 2026-06-24). Next: writing-plans.
**Branch:** `phase-6-open-in-glint` (off `master`).
**Roadmap:** ROADMAP.md → Phase 6.

## Goal

Right-click any image in Windows Explorer → **Open in Glint** → the annotation editor
opens with that image loaded, ready for arrows, crop, rounded corners, framing, etc.
This makes Glint a general-purpose lightweight image editor, not only a capture annotator.

## Constraint fit (unchanged project constraints)

- **Local-first:** no network, no upload, no accounts. Registry + local file read only. ✓
- **Single-user / no-auth:** registration is **HKCU-only** → no admin password, no UAC. ✓
- **Recorder isolation:** touches the editor/capture-load path only; zero recorder/ffmpeg/scap
  coupling. ✓
- **Non-destructive:** opening an external image never writes to or overwrites the original. ✓

## Decisions locked at brainstorming

These were the two open choices; both resolved in favor of reliability/usefulness:

1. **Explorer hook = right-click context-menu verb only.** No "set Glint as the default image
   app" / no file-association takeover. Lower-risk, no fighting the OS default-apps system,
   honors "just an extra option, never hijack the user's defaults."
2. **Registration = auto on first run + Settings toggle.** The verb is added automatically the
   first time Glint runs and re-checked (idempotent self-heal) on every launch. A Settings
   toggle (**default ON**) lets the user remove/re-add it. Rationale: the feature is useless if
   hidden behind a switch the user must discover; HKCU-only + reversible makes auto-ON safe.
3. **Registry access via the `winreg` crate** (not shelling out to `reg.exe`). Typed errors,
   clean idempotent writes/deletes, no output-parsing or `%1`-quoting fragility. Small,
   well-maintained, widely used.

## Design

### 1. Explorer shell verb (the right-click entry)

Register a single shell verb under the `image` **perceived type**, which covers
png/jpg/jpeg/webp/bmp/gif in one entry (no per-extension fan-out):

```
HKCU\Software\Classes\SystemFileAssociations\image\shell\Glint
    (default)            = "Open in Glint"      ; menu caption
    Icon                 = "<exe>,0"            ; app icon in the menu
  \command
    (default)            = "<exe>" "%1"         ; exe + the clicked file path
```

- `<exe>` comes from `std::env::current_exe()` at registration time (absolute path, current
  install location — survives the app being moved because we re-register each launch).
- HKCU (not HKLM) → **no admin**. Per-user only, which is correct for a single-user app.
- The `image` perceived type is assigned by Windows to common raster formats; using it gives one
  durable entry instead of registering each extension. (Formats lacking the perceived type still
  work via the cold-start argv path if launched some other way; the right-click entry follows the
  perceived type.)

### 2. Registration lifecycle (Rust)

A small `shell_integration` module (e.g. `src-tauri/src/shell_integration.rs`):

- `is_registered() -> bool` — reads the key, compares the stored command to the expected
  `"<current_exe>" "%1"`.
- `register() -> Result<(), String>` — idempotent write of caption + icon + command (self-heals a
  stale exe path after the app is moved/updated).
- `unregister() -> Result<(), String>` — deletes `…\shell\Glint` (and its `command` subkey).
- **Startup self-heal** in `lib.rs` setup: if the user's setting `explorer_menu_enabled` is ON
  (default true) and (`!is_registered()` or the stored exe path is stale), call `register()`.
  If the setting is OFF and it is currently registered, leave it (the toggle drives removal, not
  startup) — or, simplest: startup only *adds* when enabled+missing; the toggle handles removal.
- Two Tauri commands exposed to the frontend Settings toggle:
  `shell_register_explorer_menu()` and `shell_unregister_explorer_menu()`, each also persisting
  the `explorer_menu_enabled` setting via the existing frontend settings mechanism (or a paired
  Rust write — see Settings note below).

### 3. Settings toggle (frontend)

In `SettingsView.tsx`, add an **"Open in Glint" right-click menu** toggle:
- Reads `explorer_menu_enabled` (default **true**).
- ON → invoke `shell_register_explorer_menu`; OFF → `shell_unregister_explorer_menu`.
- Visible feedback per the project preference: a toast confirming "Added to right-click menu" /
  "Removed from right-click menu", and an error toast if the registry write fails.
- Persistence reuses the Phase-5c settings pattern (frontend plugin-sql `persistSetting` /
  `readSetting`); Rust `SettingsState` hydrates `explorer_menu_enabled` at startup so the
  self-heal check can read it. (Mirror of how other settings already flow.)

### 4. Routing the launched path into the editor

Two entry paths funnel into **one** shared handler `open_image_path(app, path)`:

- **Cold start** (Glint not running): in `lib.rs` setup, parse `std::env::args()`. If a path
  argument is present and points to a readable image, call `open_image_path`.
- **Warm start** (Glint already running): the existing `tauri-plugin-single-instance` callback
  `|app, argv, _cwd|` already receives the new process's argv. Extract the path from `argv` and
  call `open_image_path`. (Today the callback only does `window::focus_main(app)`; extend it.)

`open_image_path(app, path)`:
1. Read + decode the file via the `image` crate (already a dependency). Reject non-images /
   unreadable files → emit a toast ("Couldn't open <name> — not a supported image").
   **NOTE (decoder features):** the `image` crate is currently built with only
   `features = ["png"]`, so it can decode PNG but not JPG/WEBP/BMP/GIF. Since the `image`
   perceived type (and thus the right-click verb) covers those formats, this phase must enable
   the matching decode features — `features = ["png", "jpeg", "webp", "bmp", "gif"]` — so the
   handler can actually open what the menu offers. (Encode stays PNG-only; we only need to
   *decode* the source and re-encode to PNG for `EditorState`.)
2. Re-encode to PNG bytes for `EditorState` (consistent with the capture path, which holds PNG).
3. Set `EditorState`: `origin = "external"`, `project_path = None`, `doc = None`,
   `captureId = None` (it is **not** a Library row).
4. `open_editor_window(app)` then drive the existing `editor_source` → frontend `loadFromSource`
   → `loadDoc(base, emptyDoc, project=null)` flow (Phase 5c), so the editor opens as an
   **Untitled** document on a blank annotation layer.
5. Bring the editor window to the front (existing always-on-top/focus behavior) — visible feedback.

### 5. Editing & saving (reuses Phase 5c entirely)

- The document opens **Untitled / dirty=false** (nothing changed yet).
- **Export** → flattened PNG to `Pictures\Glint` + a Library row (unchanged).
- **Save** → writes a **new** `.glint` project via the existing dialog (never the original file).
- The user's original image on disk is **never** modified. "Save over original" is explicitly
  **out of scope** for this phase (could be a separate, clearly-labeled action later).

## Edge cases

- **Non-image / unreadable file** → friendly toast, no crash, no editor window churn.
- **App moved/updated** (exe path changed) → next launch's self-heal re-`register()`s the correct
  path (idempotent compare-then-write).
- **Multiple files selected** in Explorer → out of scope; the verb opens the single right-clicked
  file. (Windows may invoke the verb once per file; we open the first / each independently via the
  warm-start argv path — acceptable, not a focus of this phase.)
- **Toggle OFF then files already pinned** — removal deletes the key; existing right-click entries
  disappear on next Explorer refresh.
- **Registry write denied** (rare under HKCU) → error toast; app still works for captures.

## Testing

- **Rust units:**
  - expected command string = `"<exe>" "%1"` assembly,
  - `is_registered` compare logic (matching / stale / missing),
  - argv path extraction (path present / absent / non-image extension),
  - register→is_registered→unregister round-trip against a **test subkey** (not the real
    `…\shell\Glint`) to avoid polluting the dev machine's registry.
- **At-screen:**
  - Right-click a PNG/JPG in Explorer → "Open in Glint" appears → opens the editor with the image.
  - Cold start (app closed) vs warm start (app running) both route correctly; warm start does not
    spawn a second tray-core.
  - Settings toggle OFF removes the entry; ON re-adds it; toasts fire.
  - Right-click a non-image (or feed a bad path) → friendly toast, no crash.
  - Export → PNG to Library; Save → new `.glint`; original file on disk unchanged.

## Out of scope (this phase)

- "Set Glint as the default image app" / file-association takeover.
- "Save over original" (overwrite the source file).
- Multi-image batch open as a focused feature.
- A formal uninstaller that scrubs the registry (toggle-OFF is the supported removal path;
  HKCU keys are per-user and harmless if left).
- Any HKLM / all-users / admin-elevated registration.

## New dependency

- `winreg` (Rust crate) — Windows registry read/write for the shell verb. Windows-only, tiny,
  no transitive network/runtime concerns.
