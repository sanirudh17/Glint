//! Complete clipboard transactions prepared before acquiring the Windows lock.
//! PNG retains alpha, explicit DIB supports legacy image consumers/history,
//! and CF_HDROP gives coding agents a durable PNG attachment.
use std::{path::PathBuf, sync::{atomic::{AtomicU64, Ordering}, Mutex, OnceLock}, time::{Duration, Instant}};
static WRITES: Mutex<()> = Mutex::new(());
static REQUEST: AtomicU64 = AtomicU64::new(0);
static ROOT: OnceLock<PathBuf> = OnceLock::new();
pub fn init(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = ROOT.set(crate::attachments::directory(app)?); Ok(())
}
pub fn reserve() -> u64 { REQUEST.fetch_add(1, Ordering::SeqCst) + 1 }
fn bitmap(rgba: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || width > i32::MAX as u32 || height > i32::MAX as u32
        || width as u64 * height as u64 > 40_000_000 || rgba.len() != width as usize * height as usize * 4 {
        return Err("Couldn't read this image".into());
    }
    // BITMAPINFOHEADER + bottom-up DWORD-aligned BGR rows, without a file header.
    let stride = (width as usize * 3 + 3) & !3;
    let mut dib = vec![0u8; 40 + stride * height as usize];
    dib[0..4].copy_from_slice(&40u32.to_le_bytes());
    dib[4..8].copy_from_slice(&(width as i32).to_le_bytes());
    dib[8..12].copy_from_slice(&(height as i32).to_le_bytes());
    dib[12..14].copy_from_slice(&1u16.to_le_bytes());
    dib[14..16].copy_from_slice(&24u16.to_le_bytes());
    dib[20..24].copy_from_slice(&((stride * height as usize) as u32).to_le_bytes());
    for y in 0..height as usize { for x in 0..width as usize {
        let p = &rgba[(y * width as usize + x) * 4..];
        let at = 40 + (height as usize - 1 - y) * stride + x * 3;
        for c in 0..3 { dib[at+c] = ((p[2-c] as u32 * p[3] as u32 + 255 * (255-p[3] as u32))/255) as u8; }
    }}
    Ok(dib)
}
fn open() -> Result<clipboard_win::Clipboard, String> {
    let start = Instant::now();
    loop { match clipboard_win::Clipboard::new() {
        Ok(clipboard) => return Ok(clipboard),
        Err(_) if start.elapsed() < Duration::from_secs(2) => std::thread::sleep(Duration::from_millis(20)),
        Err(_) => return Err("Clipboard is busy. Try Copy again.".into()),
    }}
}
pub fn copy_image(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    copy_image_reserved(reserve(), rgba, width, height).map(|_| ())
}
/// false means superseded by a newer copy; never announce it as copied.
pub fn copy_image_reserved(ticket: u64, rgba: &[u8], width: u32, height: u32) -> Result<bool, String> {
    if REQUEST.load(Ordering::SeqCst) != ticket {return Ok(false);}
    let dib = bitmap(rgba, width, height)?;
    let png = crate::capture::frozen::encode_png_fast(&crate::capture::frozen::CapturedImage { width, height, rgba: rgba.to_vec() }).map_err(|e|e.to_string())?;
    let root = ROOT.get().cloned().unwrap_or_else(||std::env::temp_dir().join("glint-clipboard-attachments"));
    let attachment = crate::attachments::store(&root, &png, "png")?;
    let path = attachment.to_string_lossy();
    let format = clipboard_win::register_format("PNG").ok_or("Couldn't register the PNG clipboard format")?;
    let _serial = WRITES.lock().map_err(|_|"Restart Glint to reset the clipboard")?;
    if REQUEST.load(Ordering::SeqCst) != ticket {return Ok(false);}
    let _clipboard = open()?;
    if REQUEST.load(Ordering::SeqCst) != ticket {return Ok(false);}
    clipboard_win::raw::empty().map_err(|e|e.to_string())?;
    clipboard_win::raw::set_without_clear(format.get(), &png).map_err(|e|e.to_string())?;
    clipboard_win::raw::set_without_clear(clipboard_win::formats::CF_DIB, &dib).map_err(|e|e.to_string())?;
    clipboard_win::raw::set_file_list(&[path.as_ref()]).map_err(|e|e.to_string())?;
    Ok(true)
}
pub fn copy_text(text: &str) -> Result<(), String> {
    let ticket = reserve();
    let _serial = WRITES.lock().map_err(|_|"Restart Glint to reset the clipboard")?;
    if REQUEST.load(Ordering::SeqCst) != ticket {return Ok(());}
    let _clipboard = open()?;
    clipboard_win::raw::set_string(text).map_err(|e|e.to_string())
}
pub fn copy_file(path: &std::path::Path) -> Result<(), String> {
    if !path.is_file() {return Err("This file no longer exists".into());}
    let ticket = reserve();
    let _serial = WRITES.lock().map_err(|_|"Restart Glint to reset the clipboard")?;
    if REQUEST.load(Ordering::SeqCst) != ticket {return Ok(());}
    let _clipboard = open()?;
    clipboard_win::raw::empty().map_err(|e|e.to_string())?;
    clipboard_win::raw::set_file_list(&[path.to_string_lossy().as_ref()]).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn clipboard_copy_text(text: String) -> Result<(), String> { copy_text(&text) }
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dib_bottom_up_bgr_padding_and_alpha_fallback() {
        let dib=bitmap(&[255,0,0,255, 0,0,255,255, 0,255,0,255, 0,0,0,0],2,2).unwrap();
        assert_eq!(dib.len(),56);
        assert_eq!(&dib[40..48], &[0,255,0, 255,255,255, 0,0]);
        assert_eq!(&dib[48..56], &[0,0,255, 255,0,0, 0,0]);
        assert!(bitmap(&[],0,1).is_err()); assert!(bitmap(&[1],1,1).is_err());
    }
    #[test]
    fn superseded_capture_cannot_overwrite_a_newer_copy() {
        let old=reserve(); reserve();
        assert!(!copy_image_reserved(old,&[],0,0).unwrap());
    }
    #[test]
    #[ignore="holds the real Windows clipboard briefly; run alone"]
    fn retries_a_temporary_external_clipboard_lock() {
        let (sender,receiver)=std::sync::mpsc::channel();
        let holder=std::thread::spawn(move||{
            let _clipboard=open().unwrap();sender.send(()).unwrap();
            std::thread::sleep(Duration::from_millis(160));
        });
        receiver.recv().unwrap();let start=Instant::now();
        copy_image(&[40,80,120,255],1,1).unwrap();
        holder.join().unwrap();assert!(start.elapsed()>=Duration::from_millis(140));
    }
    #[test]
    #[ignore="writes the real Windows clipboard; run alone with owned pixels"]
    fn native_image_formats_and_durable_agent_attachment() {
        let rgba=[210,30,80,255, 20,220,60,255];
        copy_image(&rgba,2,1).unwrap();
        let png_format=clipboard_win::register_format("PNG").unwrap();
        let mut png=vec![]; {let _clipboard=open().unwrap(); clipboard_win::raw::get_vec(png_format.get(),&mut png).unwrap();}
        assert_eq!(image::load_from_memory(&png).unwrap().to_rgba8().as_raw(),&rgba);
        let mut dib=vec![]; {let _clipboard=open().unwrap(); clipboard_win::raw::get_vec(clipboard_win::formats::CF_DIB,&mut dib).unwrap();}
        assert_eq!(&dib[40..46],&[80,30,210,60,220,20]);
        let mut files=Vec::<String>::new(); {let _clipboard=open().unwrap(); clipboard_win::raw::get_file_list(&mut files).unwrap();}
        assert_eq!(files.len(),1); assert_eq!(std::fs::read(&files[0]).unwrap(),png);
    }
}
