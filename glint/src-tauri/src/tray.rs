use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

use crate::window;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Glint", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Glint", true, None::<&str>)?;

    // Capture submenu — each item calls capture::begin directly (on_menu_event).
    let cap_area = MenuItem::with_id(app, "cap_area", "Capture Area", true, None::<&str>)?;
    let cap_win = MenuItem::with_id(app, "cap_window", "Capture Window", true, None::<&str>)?;
    let cap_full = MenuItem::with_id(app, "cap_full", "Capture Fullscreen", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", "Start Recording", true, None::<&str>)?;
    let capture = Submenu::with_id_and_items(app, "capture", "Capture", true,
        &[&cap_area, &cap_win, &cap_full])?;

    let menu = Menu::with_items(app, &[
        &open, &capture, &record,
        &PredefinedMenuItem::separator(app)?,
        &settings,
        &PredefinedMenuItem::separator(app)?,
        &quit,
    ])?;

    TrayIconBuilder::with_id("glint-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Glint")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => window::focus_main(app),
            "settings" => {
                window::focus_main(app);
                let _ = app.emit("navigate", "/settings");
            }
            "quit" => app.exit(0),
            "cap_area" => crate::capture::begin(app, crate::capture::CaptureMode::Area),
            "cap_window" => crate::capture::begin(app, crate::capture::CaptureMode::Window),
            "cap_full" => {
                crate::capture::begin(app, crate::capture::CaptureMode::Fullscreen);
            }
            other => {
                let _ = app.emit("tray-action", other.to_string());
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                window::focus_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
