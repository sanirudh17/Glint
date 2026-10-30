//! App-owned optional OCR files. Never installs into or removes a system OCR installation.
use std::{
    path::{Path, PathBuf},
    sync::atomic::Ordering,
    sync::{OnceLock, RwLock},
};

const TESS_FOLDER: &str = "ocr-tesseract-5.4.0-1";
pub const TESS_BYTES: u64 = 57993532;
const TESS_HASH: &str = "2add1c85d0f1cf5bede1895ccd8531226cae76906d72e2542a22991dbeca3ab7";
const TESS_URL: &str = "https://github.com/sanirudh17/Glint/releases/download/v0.2.0/Glint-OCR-Tesseract-5.4.0-x64.zip";
static ROOT: OnceLock<PathBuf> = OnceLock::new();
pub static TESS_USE: RwLock<()> = RwLock::new(());

pub fn initialize(root: PathBuf) {
    cleanup_removed(&root);
    let _ = ROOT.set(root);
}
fn cleanup_removed(root: &Path) {
    // Single-instance setup runs before any new work: clean only Glint's private
    // removal tombstones and interrupted install/repair stages.
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten() {
            if [".ocr-removed-", ".ocr-install-", ".ocr-incomplete-"]
                .iter()
                .any(|prefix| entry.file_name().to_string_lossy().starts_with(*prefix))
                && entry
                    .file_type()
                    .is_ok_and(|t| t.is_dir() && !t.is_symlink())
            {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}
pub fn root() -> Result<&'static Path, String> {
    ROOT.get()
        .map(PathBuf::as_path)
        .ok_or("OCR storage is not initialized".into())
}
pub fn folder(engine: &str) -> Result<&'static str, String> {
    match engine {
        "tesseract" => Ok(TESS_FOLDER),
        "ppocrv6-small" => Ok("ocr-ppv6-small-1"),
        "ppocrv6-medium" => Ok("ocr-ppv6-medium-1"),
        _ => Err("Unknown OCR engine".into()),
    }
}
pub fn tesseract_root() -> Option<PathBuf> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("GLINT_TEST_TESSERACT_ROOT") {
        return Some(PathBuf::from(path));
    }
    let path = root().ok()?.join(TESS_FOLDER);
    (path.join("ready.json").is_file() && valid_tesseract(&path)).then_some(path)
}
fn valid_tesseract(path: &Path) -> bool {
    [
        "tesseract.exe",
        "libtesseract-5.dll",
        "tessdata/eng.traineddata",
    ]
    .iter()
    .all(|file| {
        path.join(file)
            .metadata()
            .is_ok_and(|m| m.is_file() && m.len() > 0)
    })
}
pub fn tesseract_installed() -> bool {
    tesseract_root().is_some_and(|p| valid_tesseract(&p))
}

pub fn install_tesseract(app: &tauri::AppHandle) -> Result<(), String> {
    if tesseract_installed() {
        return Ok(());
    }
    let parent = root()?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let stage = parent.join(format!(".ocr-install-tesseract-{}", nonce()));
    std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        let archive = stage.join("runtime.zip");
        super::neural::download(app, TESS_URL, &archive, TESS_BYTES, TESS_HASH)?;
        super::neural::notify(app, "Installing Tesseract", 99.);
        unpack_tesseract(&archive, &stage)?;
        if super::neural::CANCEL.load(Ordering::Relaxed) {
            return Err("Download cancelled".into());
        }
        std::fs::remove_file(archive).map_err(|e| e.to_string())?;
        std::fs::write(
            stage.join("ready.json"),
            r#"{"engine":"tesseract","version":"5.4.0","language":"English"}"#,
        )
        .map_err(|e| e.to_string())?;
        let destination = parent.join(TESS_FOLDER);
        // Replace only an incomplete app-owned installation, never a system folder.
        if destination.exists() {
            remove_owned(parent, "tesseract")?;
        }
        std::fs::rename(&stage, &destination).map_err(|e| e.to_string())?;
        super::neural::notify(app, "OCR engine ready", 100.);
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(stage);
    }
    result
}
fn unpack_tesseract(archive: &Path, destination: &Path) -> Result<(), String> {
    verify_package(archive)?;
    // The archive is our fixed, SHA-256-verified asset; it contains only runtime/data/notices.
    let mut cmd = std::process::Command::new("tar.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(destination)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() || !valid_tesseract(destination) {
        return Err("Could not unpack the Tesseract engine".into());
    }
    Ok(())
}
fn verify_package(archive: &Path) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != TESS_BYTES {
        return Err("The OCR download is incomplete. Please retry.".into());
    }
    let mut hash = Sha256::new();
    let mut bytes = [0u8; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    if format!("{:x}", hash.finalize()) != TESS_HASH {
        return Err("The OCR download failed its integrity check. Please retry.".into());
    }
    Ok(())
}
fn nonce() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removal {
    pub pending_restart: bool,
}
pub fn remove_owned(parent: &Path, engine: &str) -> Result<Removal, String> {
    let directory = parent.join(folder(engine)?);
    if !directory.exists() {
        return Ok(Removal {
            pending_restart: false,
        });
    }
    let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
    let metadata = std::fs::symlink_metadata(&directory).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink()
        || directory
            .canonicalize()
            .map_err(|e| e.to_string())?
            .parent()
            != Some(canonical_parent.as_path())
    {
        return Err("This OCR folder is not managed by Glint. No files were removed.".into());
    }
    let removed = parent.join(format!(".ocr-removed-{}-{}", folder(engine)?, nonce()));
    std::fs::rename(&directory, &removed).map_err(|_| {
        "The OCR engine is in use. Restart Glint, then remove it again.".to_string()
    })?;
    // Windows can retain a loaded ONNX DLL until process exit. Models are disabled
    // immediately; the app-owned tombstone is retried on the next startup.
    Ok(Removal {
        pending_restart: std::fs::remove_dir_all(removed).is_err(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_cleanup_preserves_installed_engines_and_unrelated_files() {
        let root = std::env::temp_dir().join(format!("glint-ocr-cleanup-{}", nonce()));
        for name in [
            ".ocr-removed-old",
            ".ocr-install-interrupted",
            ".ocr-incomplete-old",
            TESS_FOLDER,
            "keep",
        ] {
            std::fs::create_dir_all(root.join(name)).unwrap();
            std::fs::write(root.join(name).join("owned-file"), b"data").unwrap();
        }
        cleanup_removed(&root);
        cleanup_removed(&root);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        assert!(root.join(TESS_FOLDER).join("owned-file").is_file());
        assert!(root.join("keep").join("owned-file").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "run after the loaded-model removal process has exited"]
    fn loaded_runtime_cleanup_after_exit() {
        let parent = PathBuf::from(std::env::var("GLINT_MODEL_LIFECYCLE").unwrap());
        let report: serde_json::Value =
            serde_json::from_slice(&std::fs::read(parent.join("result.json")).unwrap()).unwrap();
        let root = PathBuf::from(report["root"].as_str().unwrap());
        assert_eq!(
            root.parent().unwrap().canonicalize().unwrap(),
            parent.canonicalize().unwrap()
        );
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("owned-"));
        cleanup_removed(&root);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn removal_is_scoped_idempotent_and_preserves_other_engines() {
        let root = std::env::temp_dir().join(format!("glint-ocr-remove-{}", nonce()));
        let target = root.join(folder("ppocrv6-small").unwrap());
        let sibling = root.join(folder("ppocrv6-medium").unwrap());
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(target.join("model.onnx"), b"owned model").unwrap();
        std::fs::write(sibling.join("model.onnx"), b"keep").unwrap();
        assert!(
            !remove_owned(&root, "ppocrv6-small")
                .unwrap()
                .pending_restart
        );
        assert!(!target.exists());
        assert_eq!(std::fs::read(sibling.join("model.onnx")).unwrap(), b"keep");
        assert!(
            !remove_owned(&root, "ppocrv6-small")
                .unwrap()
                .pending_restart
        );
        assert!(remove_owned(&root, "../outside").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn partial_tesseract_is_not_available() {
        let root = std::env::temp_dir().join(format!("glint-ocr-partial-{}", nonce()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("tesseract.exe"), b"partial").unwrap();
        assert!(!valid_tesseract(&root));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn incomplete_archive_is_rejected_before_extraction() {
        let root = std::env::temp_dir().join(format!("glint-ocr-corrupt-{}", nonce()));
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("bad.zip");
        std::fs::write(&archive, b"incomplete").unwrap();
        assert!(unpack_tesseract(&archive, &root)
            .unwrap_err()
            .contains("incomplete"));
        assert!(!root.join("tesseract.exe").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "requires the separate Tesseract download asset"]
    fn tesseract_optional_package_roundtrip() {
        use sha2::{Digest, Sha256};
        let archive = PathBuf::from(std::env::var("GLINT_TEST_TESSERACT_ARCHIVE").unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(std::fs::read(&archive).unwrap())),
            TESS_HASH
        );
        let parent = std::env::temp_dir().join(format!("glint-ocr-package-{}", nonce()));
        let dest = parent.join(TESS_FOLDER);
        std::fs::create_dir_all(&dest).unwrap();
        unpack_tesseract(&archive, &dest).unwrap();
        let mut cmd = std::process::Command::new(dest.join("tesseract.exe"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let result = cmd.arg("--version").output().unwrap();
        assert!(result.status.success());
        assert!(String::from_utf8_lossy(&result.stdout).contains("5.4.0"));
        // Exercise the installed engine against owned pixels, then remove it.
        use font8x8::UnicodeFonts;
        let mut image = image::RgbaImage::from_pixel(520, 100, image::Rgba([255, 255, 255, 255]));
        for (index, ch) in "HELLO GLINT".chars().enumerate() {
            if let Some(glyph) = font8x8::BASIC_FONTS.get(ch) {
                for (y, row) in glyph.iter().enumerate() {
                    for x in 0..8 {
                        if row & (1 << x) != 0 {
                            for dy in 0..5 {
                                for dx in 0..5 {
                                    image.put_pixel(
                                        20 + index as u32 * 44 + x * 5 + dx,
                                        20 + y as u32 * 5 + dy,
                                        image::Rgba([0, 0, 0, 255]),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }
        let png = parent.join("owned-text.png");
        image.save(&png).unwrap();
        let mut cmd = std::process::Command::new(dest.join("tesseract.exe"));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let text = cmd
            .arg(png)
            .arg("stdout")
            .args(["--psm", "7", "-l", "eng", "--tessdata-dir"])
            .arg(dest.join("tessdata"))
            .output()
            .unwrap();
        assert!(text.status.success());
        assert!(
            String::from_utf8_lossy(&text.stdout).contains("HELLO"),
            "{:?}",
            text
        );
        assert!(!remove_owned(&parent, "tesseract").unwrap().pending_restart);
        assert!(!dest.exists());
        std::fs::remove_dir_all(parent).unwrap();
    }
}
