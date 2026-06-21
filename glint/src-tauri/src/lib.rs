mod capture;
mod clipboard;
mod db;
mod overlay;
mod paths;
mod settings;
mod shortcuts;
mod tray;
mod window;

use capture::commands::{capture_cancel, capture_commit, capture_overlay_data};
use settings::commands::{settings_get_all, settings_set, SettingsState};

/// Start a capture from the main-window UI (the Home quick-start buttons).
/// Hotkeys and the tray call `capture::begin` directly while the main window is
/// already hidden; this command additionally hides the main window first — so
/// Glint isn't baked into the frozen frame — gives the compositor a beat to
/// remove it, then begins.
#[tauri::command]
fn capture_start(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    use std::str::FromStr;
    use tauri::Manager;
    let m = crate::capture::CaptureMode::from_str(&mode)
        .map_err(|_| format!("unknown capture mode: {mode}"))?;
    // Hide the main window so Glint isn't baked into the frozen frame.
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    // Run capture OFF the main thread (this sync command runs on the main thread,
    // and building the overlay webview there deadlocks the event loop). Give the
    // hide a beat to take effect on screen, then begin.
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        crate::capture::begin(&app2, m);
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("glint".into()),
                    },
                ))
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000_u128)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_drag::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:glint.db", db::migrations())
                .build(),
        )
        .manage(SettingsState(Default::default()))
        .manage(crate::capture::CaptureState::default())
        .setup(|app| {
            tray::build(app.handle())?;
            shortcuts::register(app.handle())?;
            log::info!("Glint started");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings_get_all,
            settings_set,
            capture_overlay_data,
            capture_commit,
            capture_cancel,
            capture_start,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
