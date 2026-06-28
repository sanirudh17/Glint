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
                            crate::capture::begin_spawned(handle, crate::capture::CaptureMode::Area);
                        }
                        "capture_window" => {
                            crate::capture::begin_spawned(
                                handle,
                                crate::capture::CaptureMode::Window,
                            );
                        }
                        "capture_fullscreen" => {
                            crate::capture::begin_spawned(
                                handle,
                                crate::capture::CaptureMode::Fullscreen,
                            );
                        }
                        "record" => {
                            let h = handle.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = crate::recorder::recorder_open_region_selector(h).await;
                            });
                        }
                        "copy_path" => {
                            // Copy the most recent capture's file path to the clipboard.
                            // Do NOT focus/raise the main window — the "Path copied" toast
                            // already reaches the (always-on-top) HUD, which is feedback
                            // enough; popping the app to the front is intrusive.
                            let path = handle
                                .state::<crate::capture::LastCaptureState>()
                                .0
                                .lock()
                                .unwrap()
                                .as_ref()
                                .map(|l| l.path.clone());
                            let msg = match path {
                                Some(p) => match crate::clipboard::copy_text(&p) {
                                    Ok(()) => "Path copied",
                                    Err(e) => {
                                        log::warn!("copy_path failed: {e}");
                                        "Couldn't copy path"
                                    }
                                },
                                None => "No capture to copy yet",
                            };
                            let _ = handle.emit("glint-toast", msg);
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
