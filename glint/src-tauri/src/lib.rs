mod autostart;
mod capture;
mod clipboard;
mod db;
mod editor;
mod hud;
mod ocr;
mod overlay;
mod paths;
mod pin;
mod recorder;
mod settings;
mod shell_integration;
mod shortcuts;
mod tray;
mod window;

use capture::commands::{
    capture_cancel, capture_commit, capture_copy, capture_copy_path, capture_delete, capture_open,
    capture_overlay_data, capture_rename, capture_reveal, captures_list, drag_blank_icon, reveal_path,
    tray_annotate, tray_clear, tray_copy, tray_copy_path, tray_dismiss, tray_extract_text,
    tray_list, tray_pin, tray_resize, tray_reveal, tray_save,
};
use editor::commands::{
    consume_pending_external_open, editor_copy, editor_done, editor_flatten_temp,
    editor_open_capture, editor_open_from_last, editor_save, editor_source, project_open,
    project_save, projects_resolve,
};
use settings::commands::{
    hotkeys_resume, hotkeys_suspend, settings_get_all, settings_reset_hotkeys, settings_set,
    autostart_get, autostart_set, settings_set_hotkey, settings_set_save_dir, storage_paths,
    window_set_taskbar, SettingsState,
};
use pin::{
    pin_close, pin_context_menu, pin_copy, pin_create_from_capture, pin_create_from_last, pin_data,
    pin_save,
};
use shell_integration::{shell_register_explorer_menu, shell_unregister_explorer_menu};

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
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // A second launch (e.g. "Open in Glint" while Glint is already running)
            // delivers its argv here. An image opens in the editor; a video opens in the
            // trim window; anything else just brings the existing window forward.
            match crate::editor::commands::first_image_arg(&argv) {
                Some(path) => {
                    if let Err(e) = crate::editor::commands::open_image_path(app, &path, false) {
                        let _ = tauri::Emitter::emit(app, "glint-toast", e);
                    }
                }
                None => match crate::recorder::trim::first_video_arg(&argv) {
                    Some(vpath) => crate::recorder::open_trim_for_external(app, vpath),
                    None => window::focus_main(app),
                },
            }
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
        .plugin(tauri_plugin_shell::init())
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
        .manage(crate::capture::tray::TrayState::default())
        .manage(crate::editor::EditorState::default())
        .manage(crate::editor::PendingOpen::default())
        .manage(crate::pin::PinState::default())
        .manage(crate::recorder::RecorderState::default())
        .manage(crate::recorder::RecorderHud::default())
        .manage(crate::recorder::RecorderTrimState::default())
        .manage(crate::ocr::OcrState::default())
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

            // Apply the persisted taskbar preference to the main window.
            {
                let show = app.state::<SettingsState>().0.lock().unwrap().show_in_taskbar;
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_skip_taskbar(!show);
                }
            }

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

            // Cold start: launched with a file path ("Open in Glint" while Glint was not
            // running). An image loads in the editor now (synchronous so the pending flag
            // is set before the webview mounts). A video opens the trim window — the build
            // is spawned off-thread by open_trim_for_external (window-build rule), so it
            // safely runs once the event loop starts.
            {
                let args: Vec<String> = std::env::args().collect();
                if let Some(path) = crate::editor::commands::first_image_arg(&args) {
                    if let Err(e) = crate::editor::commands::open_image_path(app.handle(), &path, true) {
                        log::warn!("cold-start open failed: {e}");
                    }
                } else if let Some(vpath) = crate::recorder::trim::first_video_arg(&args) {
                    crate::recorder::open_trim_for_external(app.handle(), vpath);
                }
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
            // Drop a pin's in-memory bytes when its window is destroyed (any
            // close path) so a closed pin never leaks its image for the session.
            if let tauri::WindowEvent::Destroyed = event {
                let label = window.label();
                if label.starts_with("pin-") {
                    use tauri::Manager;
                    if let Some(pins) = window.try_state::<crate::pin::PinState>() {
                        crate::pin::forget(&pins, label);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings_get_all,
            settings_set,
            settings_set_hotkey,
            settings_reset_hotkeys,
            hotkeys_suspend,
            hotkeys_resume,
            storage_paths,
            settings_set_save_dir,
            autostart_get,
            autostart_set,
            window_set_taskbar,
            capture_overlay_data,
            capture_commit,
            capture_cancel,
            capture_start,
            tray_list,
            tray_copy,
            tray_copy_path,
            tray_save,
            tray_reveal,
            tray_pin,
            tray_annotate,
            tray_extract_text,
            tray_dismiss,
            tray_clear,
            tray_resize,
            captures_list,
            capture_open,
            capture_reveal,
            reveal_path,
            capture_copy,
            capture_copy_path,
            capture_delete,
            capture_rename,
            drag_blank_icon,
            editor_open_from_last,
            editor_open_capture,
            editor_source,
            editor_copy,
            editor_save,
            editor_flatten_temp,
            editor_done,
            project_save,
            project_open,
            projects_resolve,
            consume_pending_external_open,
            shell_register_explorer_menu,
            shell_unregister_explorer_menu,
            pin_create_from_last,
            pin_create_from_capture,
            pin_data,
            pin_save,
            pin_copy,
            pin_close,
            pin_context_menu,
            recorder::recorder_ffmpeg_check,
            recorder::recorder_audio_check,
            recorder::recorder_start,
            recorder::recorder_pause,
            recorder::recorder_resume,
            recorder::recorder_stop,
            recorder::recorder_cancel,
            recorder::recorder_status,
            recorder::recorder_set_mute,
            recorder::recorder_set_webcam,
            recorder::recorder_set_fx,
            recorder::recorder_open_region_selector,
            recorder::rec_hud_data,
            recorder::rec_hud_dismiss,
            crate::recorder::trim::recorder_trim_probe,
            crate::recorder::trim::recorder_trim_export,
            recorder::recorder_open_trim,
            recorder::recorder_trim_target,
            crate::ocr::commands::ocr_result,
            crate::ocr::commands::ocr_extract_capture,
            crate::ocr::commands::ocr_extract_last,
            crate::ocr::commands::ocr_capture_region,
            crate::ocr::commands::ocr_copy,
        ])
        .on_menu_event(|app, event| {
            // Pin right-click menus pop up via WebviewWindow::popup_menu and route
            // here (the tray keeps its own handler). Item ids are
            // `pin-menu|<label>|<action>`; everything else is ignored.
            if let Some((label, action)) = event
                .id()
                .as_ref()
                .strip_prefix("pin-menu|")
                .and_then(|rest| rest.split_once('|'))
            {
                crate::pin::handle_menu_action(app, label, action);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
