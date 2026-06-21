mod capture;
mod clipboard;
mod db;
mod overlay;
mod settings;
mod shortcuts;
mod tray;
mod window;

use capture::commands::{capture_cancel, capture_commit, capture_overlay_data};
use settings::commands::{settings_get_all, settings_set, SettingsState};

/// SPIKE (throwaway, P3 drag de-risk): write a known gradient PNG to the temp
/// dir and return its absolute path, so the /dragtest route has a real file to
/// drag out via tauri-plugin-drag. Remove once the drag-out path is proven and
/// the real HUD owns the file path.
#[tauri::command]
fn spike_make_test_png(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("tmp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("glint-dragtest.png");
    let (w, h) = (320u32, 200u32);
    let mut rgba = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        for x in 0..w {
            rgba.push((x * 255 / w) as u8);
            rgba.push((y * 255 / h) as u8);
            rgba.push(0x5Bu8);
            rgba.push(0xFFu8);
        }
    }
    let img = capture::frozen::CapturedImage { width: w, height: h, rgba };
    let png = capture::frozen::encode_png(&img).map_err(|e| e.to_string())?;
    std::fs::write(&path, &png).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
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
            spike_make_test_png,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Glint");
}
