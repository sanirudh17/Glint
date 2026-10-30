//! Compositor-owned desktop acrylic, matching Seek's material. Capture overlays
//! deliberately never receive a window-wide backdrop or a changed affinity.
use tauri::WebviewWindow;

#[tauri::command]
pub fn window_material(window: WebviewWindow, glass: bool, dark: bool, system: Option<bool>) -> bool {
    if !matches!(window.label(), "main" | "editor" | "rec-trim" | "rec-notes") {
        return false;
    }
    // Use the frontend's resolved appearance, not the saved preference: theme
    // changes are optimistic and the Rust settings copy may still be the old one.
    // Preserve native System tracking; the preference travels with this request
    // so it cannot race the optimistic frontend and persisted settings.
    let _=window.set_theme(if system.unwrap_or(false) {None} else {Some(if dark {tauri::Theme::Dark} else {tauri::Theme::Light})});
    // Cover the native surface BEFORE tearing down acrylic, too. Frontend paint
    // and native composition do not necessarily complete in the same frame.
    if !glass {
        let _=window.set_background_color(Some(if dark {tauri::window::Color(8,8,8,255)} else {tauri::window::Color(246,247,249,255)}));
    }
    let applied = apply(&window, glass, dark);
    // A transparent WebView surface is required for DWM's desktop material.
    // On unsupported systems the frontend retains its fully opaque palette.
    let color = if applied { tauri::window::Color(0,0,0,0) }
        else if dark { tauri::window::Color(8,8,8,255) }
        else { tauri::window::Color(246,247,249,255) };
    let _ = window.set_background_color(Some(color));
    applied
}

#[cfg(windows)]
fn apply(window: &WebviewWindow, glass: bool, dark: bool) -> bool {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows::Win32::{Foundation::HWND, UI::Controls::MARGINS,
        Graphics::Dwm::{DwmSetWindowAttribute,DwmExtendFrameIntoClientArea,DWMWINDOWATTRIBUTE}};
    let Ok(handle)=window.window_handle() else {return false};
    let RawWindowHandle::Win32(raw)=handle.as_raw() else {return false};
    let hwnd=HWND(raw.hwnd.get() as *mut core::ffi::c_void);
    // Windows respects the system transparency preference.
    let allowed=winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize")
        .and_then(|key|key.get_value::<u32,_>("EnableTransparency")).unwrap_or(1)!=0;
    let enabled=glass&&allowed;
    let set=|attribute,value:u32| unsafe {DwmSetWindowAttribute(hwnd,DWMWINDOWATTRIBUTE(attribute),(&value as *const u32).cast(),4)};
    let _=set(20,dark as u32); // immersive dark appearance
    let _=set(33,2); // DWMWCP_ROUND, compositor corners (no GDI clipping)
    // Windows 11 system acrylic reflects live content behind the window.
    // This is the same DWMSBT_TRANSIENTWINDOW material used by Seek.
    let accepted=set(38,if enabled {3} else {1}).is_ok()&&enabled;
    let inset=if accepted {-1} else {1};
    let margins=MARGINS{cxLeftWidth:inset,cxRightWidth:inset,cyTopHeight:inset,cyBottomHeight:inset};
    let extended=unsafe{DwmExtendFrameIntoClientArea(hwnd,&margins)}.is_ok();
    if accepted&&!extended {let _=set(38,1);}
    accepted&&extended
}

#[cfg(not(windows))]
fn apply(_: &WebviewWindow, _: bool, _: bool) -> bool { false }
