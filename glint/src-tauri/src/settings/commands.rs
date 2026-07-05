use std::sync::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use super::hotkeys::{self, HotkeyError, HOTKEY_ACTIONS};
use super::locations::{save_dir, SaveKind};
use super::{apply_update, Hotkeys, Settings};

pub struct SettingsState(pub Mutex<Settings>);

#[tauri::command]
pub fn settings_get_all(state: State<SettingsState>) -> Settings {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
pub fn settings_set(
    state: State<SettingsState>,
    key: String,
    value: serde_json::Value,
) -> Result<Settings, String> {
    let mut s = state.0.lock().unwrap();
    apply_update(&mut s, &key, value)?;
    Ok(s.clone())
}

// ─── Rebindable hotkeys ───────────────────────────────────────────────────────

/// User-facing label for an action key (matches the Hotkeys panel labels).
fn action_label(action: &str) -> String {
    match action {
        "capture_area" => "Capture area",
        "capture_window" => "Capture window",
        "capture_fullscreen" => "Capture fullscreen",
        "record" => "Record",
        "copy_path" => "Copy path",
        _ => action,
    }
    .to_string()
}

fn friendly(e: HotkeyError) -> String {
    match e {
        HotkeyError::Empty => "Shortcut is empty.".to_string(),
        HotkeyError::NoModifier => "Add Ctrl, Alt, or Win to the shortcut.".to_string(),
        HotkeyError::BadKey(_) => "That key can't be used in a shortcut.".to_string(),
        HotkeyError::Duplicate(a) => format!("Already used by {a}."),
    }
}

/// Rebind one action. Validates → dedupe → write in-memory → re-register with the OS.
/// On OS conflict, rolls back the previous binding (and re-arms it) and returns a message.
/// An empty `accelerator` clears/disables the shortcut. Returns the updated Settings.
#[tauri::command]
pub fn settings_set_hotkey(
    app: AppHandle,
    state: State<SettingsState>,
    action: String,
    accelerator: String,
) -> Result<Settings, String> {
    // The frontend suspends (unregisters) shortcuts while capturing the combo, so this
    // command MUST re-arm on EVERY exit — including validation errors. It is then the single
    // owner of the post-rebind registration: the frontend must NOT reapply again afterwards,
    // or the second unregister/register races the OS and drops the just-set shortcut.
    let rearm = || { let _ = crate::shortcuts::reapply(&app, false); };

    if !HOTKEY_ACTIONS.contains(&action.as_str()) {
        rearm();
        return Err(format!("Unknown action: {action}"));
    }
    let accel = accelerator.trim().to_string();
    if !accel.is_empty() {
        if let Err(e) = hotkeys::validate_accelerator(&accel) {
            rearm();
            return Err(friendly(e));
        }
    }

    let old = {
        let mut s = state.0.lock().unwrap();
        if !accel.is_empty() {
            if let Some(other) = hotkeys::duplicate_of(&s.hotkeys, &action, &accel) {
                let label = action_label(&other);
                drop(s);
                rearm();
                return Err(friendly(HotkeyError::Duplicate(label)));
            }
        }
        let old = hotkeys::get_field(&s.hotkeys, &action).unwrap_or("").to_string();
        hotkeys::set_field(&mut s.hotkeys, &action, accel.clone());
        old
    }; // lock dropped before reapply (which re-locks SettingsState)

    match crate::shortcuts::reapply(&app, true) {
        Ok(()) => Ok(state.0.lock().unwrap().clone()),
        Err(msg) => {
            {
                let mut s = state.0.lock().unwrap();
                hotkeys::set_field(&mut s.hotkeys, &action, old);
            }
            let _ = crate::shortcuts::reapply(&app, false); // re-arm the previous set
            Err(msg)
        }
    }
}

/// Restore all five shortcuts to their defaults, re-register, return updated Settings.
#[tauri::command]
pub fn settings_reset_hotkeys(
    app: AppHandle,
    state: State<SettingsState>,
) -> Result<Settings, String> {
    {
        let mut s = state.0.lock().unwrap();
        s.hotkeys = Hotkeys::default();
    }
    let _ = crate::shortcuts::reapply(&app, false);
    Ok(state.0.lock().unwrap().clone())
}

/// Temporarily disarm all global shortcuts (while the panel is capturing a key press, so
/// pressing e.g. Ctrl+Shift+1 to rebind doesn't fire the capture action).
#[tauri::command]
pub fn hotkeys_suspend(app: AppHandle) {
    crate::shortcuts::unregister_all(&app);
}

/// Re-arm all global shortcuts from current settings (after capture ends / on cancel).
#[tauri::command]
pub fn hotkeys_resume(app: AppHandle) {
    let _ = crate::shortcuts::reapply(&app, false);
}

// ─── Storage / custom capture folder ──────────────────────────────────────────

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
        let probe = p.join(".glint-write-test");
        std::fs::write(&probe, b"").map_err(|_| "That folder isn't writable.".to_string())?;
        let _ = std::fs::remove_file(&probe);
    }
    let state = app.state::<SettingsState>();
    let mut s = state.0.lock().unwrap();
    s.save_dir = trimmed;
    Ok(s.clone())
}

// ─── Launch at login ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn autostart_get() -> bool {
    crate::autostart::is_enabled()
}

#[tauri::command]
pub fn autostart_set(on: bool) -> Result<(), String> {
    crate::autostart::set_enabled(on)
}

// ─── Show in taskbar ──────────────────────────────────────────────────────────

/// Show/hide the main window's taskbar button (the tray icon is unaffected).
#[tauri::command]
pub fn window_set_taskbar(app: AppHandle, on: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.set_skip_taskbar(!on).map_err(|e| e.to_string())?;
    }
    Ok(())
}
