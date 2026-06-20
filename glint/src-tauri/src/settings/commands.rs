use std::sync::Mutex;
use tauri::State;

use super::{apply_update, Settings};

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
