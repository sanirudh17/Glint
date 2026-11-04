use std::path::{Path, PathBuf};

pub fn write_unsaved(dir: &Path, png: &[u8], editor_only: bool) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = if editor_only {
        // Last-capture actions need a file, but editor captures never enter the
        // tray that owns and cleans up individually named temporary captures.
        dir.join("editor-latest.png")
    } else {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        crate::paths::dedupe(dir, &format!("glint-{ts}.png"), |path| path.exists())
    };
    std::fs::write(&path, png)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editor_capture_cache_is_bounded_and_keeps_tray_files_intact() {
        let dir = std::env::temp_dir().join(format!(
            "glint-capture-files-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        let tray = write_unsaved(&dir, b"tray image", false).unwrap();
        let editor = write_unsaved(&dir, b"first editor image", true).unwrap();
        for _ in 0..20 {
            assert_eq!(
                write_unsaved(&dir, b"latest editor image", true).unwrap(),
                editor
            );
        }
        assert_eq!(std::fs::read(&editor).unwrap(), b"latest editor image");
        assert_eq!(std::fs::read(&tray).unwrap(), b"tray image");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        let second_tray = write_unsaved(&dir, b"second tray image", false).unwrap();
        assert_ne!(tray, second_tray);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
