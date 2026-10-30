//! Durable snapshots handed to other apps. Never owned by the transient HUD.
use std::{
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;

pub fn store(root: &Path, bytes: &[u8], extension: &str) -> Result<PathBuf, String> {
    if !matches!(extension, "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp") {
        return Err("Unsupported image format".into());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    bytes.hash(&mut hash);
    let stem = format!("glint-{:016x}-{}", hash.finish(), bytes.len());
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{suffix}.{extension}")
        };
        let path = root.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(bytes) {
                    let _ = std::fs::remove_file(&path);
                    return Err(error.to_string());
                }
                return Ok(path);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if std::fs::read(&path).ok().as_deref() == Some(bytes) {
                    return Ok(path);
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Couldn't create an image attachment".into())
}
pub fn preserve(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let extension = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
    ) {
        return path
            .canonicalize()
            .map_err(|_| "This file no longer exists".into());
    }
    let size = std::fs::metadata(path)
        .map_err(|_| "This image no longer exists")?
        .len();
    if size > 128 * 1024 * 1024 {
        return Err("This image is too large to attach".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "Couldn't read this image")?;
    store(root, &bytes, &extension)
}
pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("attachments"))
}
#[tauri::command(async)]
pub fn drag_prepare(app: tauri::AppHandle, path: String) -> Result<String, String> {
    preserve(&directory(&app)?, Path::new(&path)).map(|p| p.to_string_lossy().into_owned())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn attachment_survives_source_eviction_and_reuses_unchanged_bytes() {
        let root = std::env::temp_dir().join(format!(
            "glint-attachment-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("temporary.png");
        std::fs::write(&source, b"fake fixture bytes").unwrap();
        let saved = preserve(&root.join("attachments"), &source).unwrap();
        assert_eq!(saved, preserve(&root.join("attachments"), &source).unwrap());
        std::fs::remove_file(source).unwrap();
        assert_eq!(std::fs::read(&saved).unwrap(), b"fake fixture bytes");
        assert!(store(&root.join("attachments"), b"x", "../../png").is_err());
        std::fs::remove_file(saved).unwrap();
        std::fs::remove_dir(root.join("attachments")).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
