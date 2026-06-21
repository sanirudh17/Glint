mod db;
mod settings;
mod shortcuts;
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
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:glint.db", db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .manage(SettingsState(Default::default()))
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
        .invoke_handler(tauri::generate_handler![settings_get_all, settings_set])
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
