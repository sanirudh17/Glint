use std::sync::Mutex;
use tauri::{AppHandle, State};

use super::hotkeys::{self, HotkeyError, HOTKEY_ACTIONS};
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
    if !HOTKEY_ACTIONS.contains(&action.as_str()) {
        return Err(format!("Unknown action: {action}"));
    }
    let accel = accelerator.trim().to_string();
    if !accel.is_empty() {
        hotkeys::validate_accelerator(&accel).map_err(friendly)?;
    }

    let old = {
        let mut s = state.0.lock().unwrap();
        if !accel.is_empty() {
            if let Some(other) = hotkeys::duplicate_of(&s.hotkeys, &action, &accel) {
                return Err(friendly(HotkeyError::Duplicate(action_label(&other))));
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
