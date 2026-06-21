use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::settings::commands::SettingsState;
use crate::window;

/// Register global shortcuts from the current settings.
///
/// Each of the five configured hotkeys is registered with an individual
/// handler that closes over the action name string.  On `Pressed` state
/// the handler focuses the main window and emits `"shortcut-fired"` with
/// the action name as payload.
///
/// Registration errors (parse failure, OS conflict) are logged with
/// `log::warn` and skipped — a bad or conflicting hotkey must never crash
/// startup.
pub fn register(app: &AppHandle) -> tauri::Result<()> {
    // Snapshot the hotkey strings from managed state.
    let hotkeys = {
        let state = app.state::<SettingsState>();
        let settings = state.0.lock().unwrap();
        let h = &settings.hotkeys;
        [
            (h.capture_area.clone(), "capture_area"),
            (h.capture_window.clone(), "capture_window"),
            (h.capture_fullscreen.clone(), "capture_fullscreen"),
            (h.record.clone(), "record"),
            (h.copy_path.clone(), "copy_path"),
        ]
    };

    for (accel, action) in hotkeys {
        let action_name = action; // &'static str — no allocation needed
        let result = app.global_shortcut().on_shortcut(
            accel.as_str(),
            move |handle, _shortcut, event| {
                // Only fire on key-down; ignore the release to avoid double-fire.
                if event.state == ShortcutState::Pressed {
                    match action_name {
                        "capture_area" => {
                            crate::capture::begin(handle, crate::capture::CaptureMode::Area);
                        }
                        "capture_window" => {
                            crate::capture::begin(handle, crate::capture::CaptureMode::Window);
                        }
                        "capture_fullscreen" => {
                            crate::capture::begin(
                                handle,
                                crate::capture::CaptureMode::Fullscreen,
                            );
                        }
                        other => {
                            window::focus_main(handle);
                            let _ = handle.emit("shortcut-fired", other);
                        }
                    }
                }
            },
        );

        match result {
            Ok(()) => {
                log::info!("Registered global shortcut: {} -> {}", accel, action_name);
            }
            Err(e) => {
                log::warn!(
                    "Failed to register global shortcut '{}' for action '{}': {}",
                    accel,
                    action_name,
                    e
                );
            }
        }
    }

    Ok(())
}
