//! Pure path & filename helpers for saving captures and the `latest.png` mirror.
//!
//! No OS calls here — the command layer resolves the Pictures/home directories
//! via Tauri's path resolver and passes them in, keeping this module unit-tested
//! and platform-agnostic.

use chrono::{DateTime, Local};
use std::path::{Path, PathBuf};

/// Filesystem-safe capture filename, e.g. `Glint 2026-06-21 at 14.30.05.png`.
/// Colons are avoided (illegal on Windows) — time uses dots. `ext` is the extension
/// without a dot (e.g. "png", "jpg", "webp").
pub fn capture_filename(dt: DateTime<Local>, ext: &str) -> String {
    dt.format(&format!("Glint %Y-%m-%d at %H.%M.%S.{ext}")).to_string()
}

/// The default save directory: `<pictures>/Glint`.
pub fn glint_save_dir(pictures: &Path) -> PathBuf {
    pictures.join("Glint")
}

/// The stable "latest" mirror path: `<home>/.glint/latest.png`.
pub fn latest_png(home: &Path) -> PathBuf {
    home.join(".glint").join("latest.png")
}

/// Thumbnail storage dir: `<app_local_data>/thumbs`.
pub fn thumbs_dir(app_local: &Path) -> PathBuf {
    app_local.join("thumbs")
}

/// Resolve a non-colliding path in `dir` for `filename`. If it is free, return
/// `dir/filename`; otherwise insert ` (n)` before the extension until free.
/// `exists` is injected so this stays pure and testable.
pub fn dedupe(dir: &Path, filename: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(filename);
    if !exists(&first) {
        return first;
    }
    let p = Path::new(filename);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(filename);
    let ext = p.extension().and_then(|s| s.to_str());
    let mut n = 1u32;
    loop {
        let name = match ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let candidate = dir.join(name);
        if !exists(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use std::collections::HashSet;

    #[test]
    fn capture_filename_uses_ext() {
        let dt = Local.with_ymd_and_hms(2026, 6, 21, 14, 30, 5).unwrap();
        assert_eq!(capture_filename(dt, "png"), "Glint 2026-06-21 at 14.30.05.png");
        assert_eq!(capture_filename(dt, "jpg"), "Glint 2026-06-21 at 14.30.05.jpg");
    }

    #[test]
    fn save_dir_and_latest_join_correctly() {
        assert_eq!(
            glint_save_dir(Path::new("C:/Users/x/Pictures")),
            PathBuf::from("C:/Users/x/Pictures/Glint")
        );
        assert_eq!(
            latest_png(Path::new("C:/Users/x")),
            PathBuf::from("C:/Users/x/.glint/latest.png")
        );
    }

    #[test]
    fn thumbs_dir_joins() {
        assert_eq!(thumbs_dir(Path::new("C:/x")), PathBuf::from("C:/x/thumbs"));
    }

    #[test]
    fn dedupe_returns_original_when_free() {
        let dir = Path::new("/d");
        let got = dedupe(dir, "Glint a.png", |_| false);
        assert_eq!(got, PathBuf::from("/d/Glint a.png"));
    }

    #[test]
    fn dedupe_suffixes_until_free() {
        let dir = Path::new("/d");
        // "Glint a.png" and "Glint a (1).png" are taken; expect " (2)".
        let taken: HashSet<PathBuf> = [
            PathBuf::from("/d/Glint a.png"),
            PathBuf::from("/d/Glint a (1).png"),
        ]
        .into_iter()
        .collect();
        let got = dedupe(dir, "Glint a.png", |p| taken.contains(p));
        assert_eq!(got, PathBuf::from("/d/Glint a (2).png"));
    }
}
