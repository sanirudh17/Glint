mod db;
mod settings;
mod tray;
mod window;

use settings::commands::{settings_get_all, settings_set, SettingsState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window::focus_main(app);
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:glint.db", db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(SettingsState(Default::default()))
        .setup(|app| {
            tray::build(app.handle())?;
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
        .invoke_handler(tauri::generate_handler![settings_get_all, settings_set])
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
