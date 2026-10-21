use tauri::Manager;
#[tauri::command(async)]
pub async fn studio_speaker_notes(app:tauri::AppHandle)->Result<(),String>{
 if let Some(win)=app.get_webview_window("rec-notes"){return win.show().map_err(|e|e.to_string());}
 let win=tauri::WebviewWindowBuilder::new(&app,"rec-notes",tauri::WebviewUrl::App("index.html#/rec-notes".into())).title("Glint speaker notes").inner_size(480.,560.).min_inner_size(320.,300.).always_on_top(true).content_protected(true).background_color(tauri::window::Color(12,13,15,255)).visible(false).build().map_err(|e|e.to_string())?;
 let protection=(||->Result<(),String>{
  #[cfg(windows)]{use raw_window_handle::{HasWindowHandle,RawWindowHandle};use windows::Win32::{Foundation::HWND,UI::WindowsAndMessaging::{SetWindowDisplayAffinity,GetWindowDisplayAffinity,WDA_EXCLUDEFROMCAPTURE}};
   let raw=win.window_handle().map_err(|e|e.to_string())?.as_raw();let RawWindowHandle::Win32(raw)=raw else{return Err("Capture exclusion is unavailable.".into());};let hwnd=HWND(raw.hwnd.get() as *mut core::ffi::c_void);unsafe{SetWindowDisplayAffinity(hwnd,WDA_EXCLUDEFROMCAPTURE).map_err(|e|e.to_string())?;let mut affinity=0;GetWindowDisplayAffinity(hwnd,&mut affinity).map_err(|e|e.to_string())?;if affinity!=WDA_EXCLUDEFROMCAPTURE.0{return Err("Windows could not exclude the notes window from capture.".into());}}
  }Ok(())})();
 if let Err(error)=protection{let _=win.destroy();return Err(error);}win.show().map_err(|e|e.to_string())
}
