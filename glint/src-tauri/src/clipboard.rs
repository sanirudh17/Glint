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
