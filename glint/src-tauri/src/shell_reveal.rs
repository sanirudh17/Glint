//! Resolve real filesystem paths and let the Shell select the item directly.
//! Explorer's command-line parser silently falls back to Home for some paths.
use std::path::PathBuf;

fn existing_path(path: &str) -> Result<PathBuf, String> {
    let resolved = std::fs::canonicalize(path).map_err(|_| {
        "This file or folder is no longer on disk. It may have been moved or deleted.".to_string()
    })?;
    // Shell display names use normal Win32/UNC paths rather than Rust's extended
    // canonical-path prefix. No URL decoding or shell string interpolation.
    let name = resolved
        .to_str()
        .ok_or("This path cannot be displayed by Windows Explorer")?;
    Ok(if let Some(unc) = name.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{unc}"))
    } else {
        PathBuf::from(name.strip_prefix(r"\\?\").unwrap_or(name))
    })
}

pub fn reveal(path: &str) -> Result<(), String> {
    let path = existing_path(path)?;
    if path.is_dir() {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .arg(&path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    // A dedicated apartment also makes this safe from sync tray handlers and
    // async Tauri commands regardless of their caller's COM apartment model.
    std::thread::spawn(move || -> Result<(), String> {
        use std::os::windows::ffi::OsStrExt;
        use windows::{
            core::PCWSTR,
            Win32::{
                System::Com::{
                    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
                },
                UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName},
            },
        };
        let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| e.to_string())?;
            struct Apartment;
            impl Drop for Apartment {
                fn drop(&mut self) {
                    unsafe {
                        CoUninitialize();
                    }
                }
            }
            let _apartment = Apartment;
            let mut item = std::ptr::null_mut();
            SHParseDisplayName(PCWSTR(name.as_ptr()), None, &mut item, 0, None)
                .map_err(|e| e.to_string())?;
            let result = SHOpenFolderAndSelectItems(item, None, 0).map_err(|e| e.to_string());
            CoTaskMemFree(Some(item.cast()));
            result
        }
    })
    .join()
    .map_err(|_| "Windows could not open the containing folder".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalizes_slashes_and_preserves_real_unicode_names() {
        let dir = std::env::temp_dir().join(format!(
            "glint-reveal-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let file = dir.join("Glint — test, with spaces & café.gif");
        std::fs::write(&file, b"fixture").unwrap();
        let forward = file.to_string_lossy().replace('\\', "/");
        let resolved = existing_path(&forward).unwrap();
        assert!(!resolved.to_string_lossy().starts_with(r"\\?\"));
        assert_eq!(resolved.file_name(), file.file_name());
        assert_eq!(std::fs::read(&resolved).unwrap(), b"fixture");
        assert!(existing_path(&dir.join("missing.gif").to_string_lossy()).is_err());
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
