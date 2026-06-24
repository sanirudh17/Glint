mod capture;
mod clipboard;
mod db;
mod editor;
mod hud;
mod overlay;
mod paths;
mod settings;
mod shell_integration;
mod shortcuts;
mod tray;
mod window;

use capture::commands::{
    capture_cancel, capture_commit, capture_copy, capture_delete, capture_open,
    capture_overlay_data, capture_reveal, captures_list, hud_copy, hud_copy_path, hud_data,
    hud_dismiss, hud_reveal, hud_save,
};
use editor::commands::{
    editor_copy, editor_flatten_temp, editor_open_capture, editor_open_from_last, editor_save,
    editor_source, project_open, project_save, projects_resolve,
};
use settings::commands::{settings_get_all, settings_set, SettingsState};

/// tray-core's owned connection to the captures table (same glint.db plugin-sql uses).
pub struct Db(pub std::sync::Mutex<rusqlite::Connection>);

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
        // restore_main = true: re-show the main window once the capture settles,
        // since we hid it above.
        crate::capture::begin_restoring(&app2, m, true);
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:glint.db", db::migrations())
                .build(),
        )
        .manage(SettingsState(Default::default()))
        .manage(crate::capture::CaptureState::default())
        .manage(crate::capture::LastCaptureState::default())
        .manage(crate::editor::EditorState::default())
        .setup(|app| {
            tray::build(app.handle())?;
            shortcuts::register(app.handle())?;

            // Open tray-core's rusqlite connection to the same glint.db plugin-sql uses.
            use tauri::Manager;
            let db_path = app
                .path()
                .app_config_dir()
                .map(|d| d.join("glint.db"))
                .map_err(|e| format!("config dir: {e}"))?;
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let conn = rusqlite::Connection::open(&db_path)
                .map_err(|e| format!("open glint.db: {e}"))?;
            let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
            // Hydrate persisted settings into the live SettingsState.
            {
                let state = app.state::<SettingsState>();
                let mut s = state.0.lock().unwrap();
                crate::settings::hydrate::hydrate_from_db(&conn, &mut s);
            }
            app.manage(Db(std::sync::Mutex::new(conn)));

            // Pre-warm the capture OVERLAY webview (hidden) so the first capture
            // doesn't pay the webview-creation cost — the dominant source of the
            // open delay. The overlay is safe to reuse because it takes focus on
            // show; the HUD is NOT pre-warmed/reused (it must stay focus-less, and
            // a hidden focus-less WebView2 stops repainting after a few cycles).
            // Off-thread + delayed so it never blocks startup.
            {
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    crate::overlay::prewarm(&h, 0);
                });
            }

            log::info!("Glint started");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                    // Drop any in-memory editing source when the window is
                    // dismissed so a capture's pixels don't linger past the
                    // session. Invisible to an open editor (its base lives in the
                    // frontend store); the next entry point repopulates this.
                    use tauri::Manager;
                    if let Some(ed) = window.try_state::<crate::editor::EditorState>() {
                        *ed.0.lock().unwrap() = None;
                    }
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
            hud_data,
            hud_copy,
            hud_copy_path,
            hud_save,
            hud_dismiss,
            hud_reveal,
            captures_list,
            capture_open,
            capture_reveal,
            capture_copy,
            capture_delete,
            editor_open_from_last,
            editor_open_capture,
            editor_source,
            editor_copy,
            editor_save,
            editor_flatten_temp,
            project_save,
            project_open,
            projects_resolve,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
