//! Image-to-clipboard via arboard. Non-fatal on failure (caller keeps the temp PNG).

pub fn copy_image(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_image(arboard::ImageData {
        width: width as usize,
        height: height as usize,
        bytes: std::borrow::Cow::Borrowed(rgba),
    })
    .map_err(|e| e.to_string())
}

/// Copy plain text to the clipboard. Used by the HUD's "Copy path" action.
pub fn copy_text(s: &str) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    cb.set_text(s.to_owned()).map_err(|e| e.to_string())
}

/// CF_HDROP on Windows: paste the actual GIF/video file, preserving animation.
pub fn copy_file(path:&std::path::Path)->Result<(),String>{
    if !path.is_file(){return Err("This file no longer exists".into())}
    arboard::Clipboard::new().map_err(|e|e.to_string())?.set().file_list(&[path]).map_err(|e|e.to_string())
}

#[tauri::command]
pub fn clipboard_copy_text(text: String) -> Result<(), String> {
    copy_text(&text)
}
