# Phase 16 — Settings Gaps — Design

**Status:** design (awaiting approval → plan)
**Branch (to be):** `phase-16-settings-gaps` → merge to `master`

## Goal

Fill the low-risk, self-contained "later phase" placeholders in Settings so the settings
surface is honest and complete: a **custom capture folder**, **Launch at login**, **Sound
effects**, **Show in taskbar**, and **Include cursor** in screenshots. Also fix the Storage
panel's **stale hardcoded paths** so it shows the real effective locations.

This is the second of three "polish capstone" phases (after Phase 15 — Rebindable Hotkeys).
Deliberately deferred to later phases: image format / JPEG quality (capture encode pipeline),
retention policy (auto-delete), and recorder fps/codec (isolated recorder follow-ups).

## Global constraints (unchanged)

- **Local-first / single-user:** no cloud, accounts, auth, or network calls. All settings
  persist only to the local SQLite `settings` table.
- **Recorder isolation (SACRED):** files under `glint/src-tauri/src/recorder/*` import nothing
  from `capture/`/`editor/`/`overlay/`/`ocr/`; `ocr/` imports nothing from `recorder/`. This
  phase lets the recorder read the custom save dir via a **`settings`** resolver — `settings`
  is **not** in the sacred-forbidden set, so this is allowed. The recorder still imports
  nothing from capture/editor/overlay/ocr. The green gate re-verifies with greps.
- **Tauri v2 IPC casing:** `invoke` arg keys are camelCase → snake_case Rust params. New
  command args are single-word (`path`, `on`) — no multi-word-key hazard.
- **Visible feedback:** every toggle/action gives immediate visible feedback (toast or inline
  state); never silent.
- **Base branch:** work on `phase-16-settings-gaps`, merge to `master`.

## Current state

- `Settings` (settings/mod.rs) already holds theme/accent/hotkeys + many bools, persisted via
  `apply_update` + the SQLite `settings` table, with 20+ unit tests. Store setters follow a
  `saveSetting` + `persistSetting` pattern.
- Screenshots save to `Pictures\Glint` (`paths::glint_save_dir` via `app.path().picture_dir()`),
  used in `capture/commands.rs::finish_commit`, `tray_save`, and `editor/commands.rs` saves.
- Recordings save to `Videos\Glint` (`recorder/mod.rs` ~line 571, `app.path().video_dir()`).
- `Storage.tsx` shows **hardcoded, wrong** paths (`%APPDATA%\com.glint.app\captures\`) and two
  "later phase" placeholders (custom folder, retention). `Capture.tsx`, `General.tsx`,
  `Recording.tsx` have disabled placeholder controls.
- Available deps: `tauri-plugin-dialog` (Rust+JS), `winreg`, the `windows` crate. No new deps.

## Design

### A. Custom capture folder

**A1. Setting + resolver.** Add `save_dir: String` to `Settings` (default `""` = use platform
defaults). `apply_update` accepts it as a string. New resolver in `settings/`:

```rust
pub enum SaveKind { Screenshot, Recording }

/// The directory new captures of `kind` should be written to. Returns the user's custom
/// `save_dir` when set; otherwise the platform default (`Pictures\Glint` / `Videos\Glint`).
/// Reads `SettingsState`; creates nothing (callers already `create_dir_all`).
pub fn save_dir(app: &tauri::AppHandle, kind: SaveKind) -> std::path::PathBuf;
```

- Both screenshots and recordings resolve through this. When `save_dir` is set, both land in
  the **same** folder (filenames + extensions distinguish PNG vs MP4). When empty, screenshots
  → `Pictures\Glint`, recordings → `Videos\Glint` (today's behavior, byte-for-byte).

**A2. Wire the save sites** to call `save_dir(app, kind)` instead of computing the dir inline:
- `capture/commands.rs::finish_commit` (auto-save screenshot path).
- `capture/commands.rs::tray_save` (Library save from the tray).
- `editor/commands.rs` save-to-Library path(s).
- `recorder/mod.rs` output-dir computation (`SaveKind::Recording`). Recorder imports
  `crate::settings::{save_dir, SaveKind}` — **allowed** (not a sacred module).

**A3. Commands + picker (frontend).**
- `storage_paths() -> StoragePaths` — returns the real effective paths for display:
  `{ screenshots, recordings, database, logs }` (resolved via `save_dir` + app dirs).
- `settings_set_save_dir(app, path: String) -> Result<Settings, String>` — validates the dir
  (non-empty → must exist or be creatable + writable; empty → clears to default), persists in
  `SettingsState`, returns updated Settings. Frontend also `persistSetting("save_dir", path)`.
- Storage panel: replace the hardcoded rows with values from `storage_paths()`; add a **Capture
  folder** field showing the current folder + **Choose…** (`plugin-dialog` `open({directory:
  true})`), **Reset to default** (sets `""`), and **Reveal** (reuses `reveal_in_explorer`).
- **No file migration** — existing Library rows keep their paths; only new captures use the new
  folder. A short note in the panel says so.

### B. Launch at login

`launch_at_login: bool` (default `false`, not persisted to the settings table as the source of
truth — the **registry is the truth**; the settings mirror is convenience). Commands:
- `autostart_get() -> bool` — reads `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, value
  `Glint`, returns whether it exists and points at the current exe.
- `autostart_set(on: bool) -> Result<(), String>` — writes the value (`"<exe path>"`) when on,
  deletes it when off, via `winreg`.
- `General.tsx` toggle calls `autostart_set` then reflects `autostart_get`; toast on
  success/failure. Store loads the real state at startup.

### C. Sound effects

`sound_effects: bool` (default `false`). A short camera-shutter **click synthesized in Rust**
(a brief filtered-noise burst with a fast decay envelope, encoded as an in-memory WAV — no
binary asset shipped) is played on screenshot commit when enabled:

```rust
// settings/sound.rs (or capture/sound.rs) — pure WAV synthesis + Win32 playback.
fn shutter_wav() -> Vec<u8>;                 // deterministic; unit-tested for a valid WAV header
pub fn play_shutter();                        // PlaySoundW(SND_MEMORY|SND_ASYNC) via `windows`
```

- Fired from `finish_commit` after a successful commit, gated by the setting. Async playback
  (`SND_ASYNC`) so it never blocks the HUD. `General.tsx` toggle.

### D. Show in taskbar

`show_in_taskbar: bool` (default `true`). On toggle, the `main` window calls
`set_skip_taskbar(!on)`; applied once at startup too (so a persisted `false` holds). Command
`window_set_taskbar(on: bool)`; `General.tsx` toggle. (The tray icon is unaffected.)

### E. Include cursor in screenshots

`include_cursor: bool` (default `false`). At **freeze time** (right after `capture_primary`
produces the frozen full-screen RGBA, before the overlay), when enabled, composite the live
mouse cursor onto the frozen buffer so it's baked into whatever region the user selects:

```rust
// capture/cursor.rs — Win32 cursor capture + alpha-composite onto RGBA.
/// Draw the current system cursor onto `rgba` (WxH, physical px) at its screen position.
/// No-op (logs) if the cursor is hidden or the API fails — never panics.
pub fn composite_cursor(rgba: &mut [u8], width: u32, height: u32, origin_x: i32, origin_y: i32);
```

- Uses `GetCursorInfo` (position + handle) → `GetIconInfo`/`DrawIconEx` into a memory DC, then
  alpha-blends the cursor pixels onto `rgba` at (cursor_x − origin_x, cursor_y − origin_y),
  accounting for the hotspot. Purely within `capture/` (no isolation concern).
- The frozen frame is primary-monitor physical px; `origin` is the monitor's top-left. Guarded:
  if the cursor is off the captured monitor or hidden, do nothing.

## Data flow (custom folder, screenshot commit)

```
finish_commit
  → dir = settings::save_dir(app, SaveKind::Screenshot)   // custom or Pictures\Glint
  → create_dir_all(dir); write PNG; (sound::play_shutter if enabled)
  → tray push / Library row use the same path
```

## Error handling

| Situation | Handling |
|-----------|----------|
| Custom folder doesn't exist / not writable | `settings_set_save_dir` returns Err → toast; setting unchanged |
| Folder picker cancelled | no-op (frontend ignores empty result) |
| Registry write fails (Launch at login) | `autostart_set` Err → toast; toggle reverts to real state |
| Sound playback fails | logged, non-fatal (capture already succeeded) |
| Cursor composite fails / cursor hidden | logged no-op; screenshot proceeds without a cursor |
| `set_skip_taskbar` fails | logged; toast |

## Testing

- **Rust unit tests:** `apply_update` accepts/validates `save_dir`, `sound_effects`,
  `show_in_taskbar`, `include_cursor` (and rejects bad types); `save_dir(kind)` resolver returns
  custom-when-set / default-when-empty (via a seeded `SettingsState` + fake app dirs where
  feasible, else a pure inner fn `resolve(save_dir, default_root)`); `shutter_wav()` produces a
  valid RIFF/WAVE header of non-zero length. (Registry, PlaySound, cursor Win32, and window
  APIs are covered at-screen — not unit-testable headless.)
- **Frontend:** existing suites stay green; no new pure-logic module warrants a Vitest suite
  beyond what the store already exercises (keep it lean).
- **Green gate:** `tsc --noEmit`, `vitest run`, `cargo build`, `cargo test`, recorder/ocr
  isolation greps.
- **At-screen acceptance:** custom folder picker changes where a new screenshot **and** a new
  recording land; Reset restores defaults; Storage shows real paths; Launch-at-login survives a
  reboot / reflects the registry; shutter plays only when enabled; Show-in-taskbar hides/shows
  the main window's taskbar button and persists; Include cursor bakes the pointer into a
  screenshot when on and omits it when off.

## Out of scope (this phase)

- Image format (PNG/JPEG/WebP) + JPEG quality — capture encode pipeline → later phase.
- Retention policy (auto-delete old captures) — later phase.
- Recorder frame rate + video codec — isolated recorder follow-ups (roadmap) → later.
- Moving/migrating existing files when the folder changes.

## Files touched

- **New:** `glint/src-tauri/src/settings/paths.rs` (`SaveKind` + `save_dir` resolver + pure
  `resolve` + tests); `glint/src-tauri/src/settings/sound.rs` (`shutter_wav` + `play_shutter`);
  `glint/src-tauri/src/capture/cursor.rs` (`composite_cursor`); `glint/src-tauri/src/
  autostart.rs` (registry get/set).
- **Modify:** `settings/mod.rs` (new fields + `apply_update` + declare modules), `settings/
  commands.rs` (`storage_paths`, `settings_set_save_dir`, `autostart_get/set`,
  `window_set_taskbar`), `capture/commands.rs` (use resolver + play shutter),
  `capture/frozen.rs` or `capture/mod.rs` (call `composite_cursor` when enabled),
  `editor/commands.rs` (use resolver), `recorder/mod.rs` (use resolver), `lib.rs` (register
  commands; apply `show_in_taskbar` at startup), and the frontend
  `views/settings/{Storage,General}.tsx`, `store/useAppStore.ts`, `lib/ipc.ts`, `views/
  settings.css`.
- **Docs:** this spec; ROADMAP reconciliation deferred to Phase 17.
