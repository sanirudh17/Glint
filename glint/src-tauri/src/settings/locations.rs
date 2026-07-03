//! Resolves where new captures are written. The custom `save_dir` setting (when set) wins;
//! otherwise the platform default (`Pictures\Glint` for screenshots, `Videos\Glint` for
//! recordings). The pure `resolve` is unit-tested; `save_dir` wires in the AppHandle.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use super::commands::SettingsState;

#[derive(Clone, Copy)]
pub enum SaveKind {
    Screenshot,
    Recording,
}

/// Pure core: the custom dir when non-empty (trimmed), else `default_root`.
pub fn resolve(save_dir: &str, default_root: PathBuf) -> PathBuf {
    let trimmed = save_dir.trim();
    if trimmed.is_empty() {
        default_root
    } else {
        PathBuf::from(trimmed)
    }
}

/// The directory new captures of `kind` should be written to. Reads `SettingsState`.
pub fn save_dir(app: &AppHandle, kind: SaveKind) -> PathBuf {
    let custom = app.state::<SettingsState>().0.lock().unwrap().save_dir.clone();
    let default_root = match kind {
        SaveKind::Screenshot => app
            .path()
            .picture_dir()
            .map(|p| p.join("Glint"))
            .unwrap_or_else(|_| PathBuf::from("Glint")),
        SaveKind::Recording => app
            .path()
            .video_dir()
            .map(|p| p.join("Glint"))
            .unwrap_or_else(|_| PathBuf::from("Glint")),
    };
    resolve(&custom, default_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_save_dir_uses_default_root() {
        let def = PathBuf::from("C:/Users/x/Pictures/Glint");
        assert_eq!(resolve("", def.clone()), def);
        assert_eq!(resolve("   ", def.clone()), def);
    }

    #[test]
    fn set_save_dir_overrides_default() {
        let def = PathBuf::from("C:/Users/x/Pictures/Glint");
        assert_eq!(resolve("D:/Shots", def), PathBuf::from("D:/Shots"));
    }
}
